// Service worker: message router and the save pipeline.
import { buildFileName, hostFromUrl, validateFolder } from "./lib/naming.js";
import { PAPER_SIZES, DEFAULTS, canCapture, getSettings, isBlocked } from "./lib/settings.js";
import { buildExpandExpression } from "./lib/expand.js";
import { MARGIN_IN, continuousPaper, countPdfPages, paperDimensions, printablePx } from "./lib/pagesize.js";

const OFFSCREEN_URL = "offscreen.html";
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;
const EXPAND_TIMEOUT_MS = 15 * 1000;
/** Prints tried for a continuous PDF before keeping one that still has more than one page. */
const CONTINUOUS_ATTEMPTS = 3;

/** Tab ids with a save in progress. */
const savingTabs = new Set();

// ---------------------------------------------------------------------------
// Message router

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target === "offscreen") return false;

  if (message.type === "get-button-state") {
    getButtonState(sender).then(sendResponse, () => sendResponse({ show: false }));
    return true;
  }

  if (message.type === "save-pdf") {
    resolveTabId(message, sender)
      .then((tabId) => savePdf(tabId))
      .then(sendResponse, (err) => sendResponse({ ok: false, error: errorText(err) }));
    return true;
  }

  return false;
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "save-pdf") return;
  const tabId = tab?.id ?? (await activeTabId());
  if (tabId == null) return;
  const result = await savePdf(tabId);
  if (!result.ok) console.warn("Save PDF failed:", result.error);
});

async function getButtonState(sender) {
  const settings = await getSettings();
  const url = sender.tab?.url ?? sender.url ?? "";
  const isTopFrame = (sender.frameId ?? 0) === 0;
  const show =
    settings.enabled && isTopFrame && canCapture(url) && !isBlocked(hostFromUrl(url), settings.blocklist);
  return { show, position: settings.position };
}

/** Content script: the sending tab. Popup: the tab it names, or the active tab. */
async function resolveTabId(message, sender) {
  if (sender.tab?.id != null) return sender.tab.id;
  if (typeof message.tabId === "number") return message.tabId;
  const tabId = await activeTabId();
  if (tabId == null) throw new Error("No active tab to save.");
  return tabId;
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id;
}

// ---------------------------------------------------------------------------
// Save pipeline

async function savePdf(tabId) {
  if (savingTabs.has(tabId)) return { ok: false, error: "A save is already running for this tab." };
  savingTabs.add(tabId);
  try {
    const settings = await getSettings();
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url ?? "";
    if (!canCapture(url)) return { ok: false, error: "This page can't be saved." };

    const folder = validateFolder(settings.folder);
    if (!folder.ok) return { ok: false, error: folder.error };
    const name = buildFileName({
      title: tab.title ?? "",
      url,
      date: new Date(),
      template: settings.template || DEFAULTS.template,
      timestampFormat: settings.timestampFormat,
    });
    const filename = folder.value ? `${folder.value}/${name}` : name;

    const base64 = await printTab(tabId, settings);
    const path = await downloadBase64(base64, filename, settings.conflict);
    return { ok: true, path };
  } catch (err) {
    return { ok: false, error: errorText(err) };
  } finally {
    savingTabs.delete(tabId);
  }
}

async function printTab(tabId, settings) {
  const target = { tabId };
  const paper = PAPER_SIZES[settings.paper] ?? PAPER_SIZES.letter;
  try {
    await chrome.debugger.attach(target, "1.3");
  } catch (err) {
    throw new Error(`Couldn't attach to the page: ${errorText(err)}`);
  }
  try {
    if (settings.expandContent) await expandContent(target);
    const common = {
      displayHeaderFooter: Boolean(settings.headerFooter),
      printBackground: Boolean(settings.printBackground),
      transferMode: "ReturnAsBase64",
    };
    if (settings.continuous) return await printContinuous(target, paper, settings, common);
    return await printToPdf(target, {
      ...common,
      landscape: Boolean(settings.landscape),
      paperWidth: paper.width,
      paperHeight: paper.height,
    });
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
  }
}

async function printToPdf(target, params) {
  const result = await chrome.debugger.sendCommand(target, "Page.printToPDF", params);
  if (!result?.data) throw new Error("Chrome returned no PDF data.");
  return result.data;
}

/**
 * Print the whole page onto one tall PDF page. The page is measured as it lays out for print at the
 * paper's width, then printed on paper exactly that tall. If the measurement came up short (print
 * layout can differ from what the page reports), the height grows and it prints again.
 */
async function printContinuous(target, paper, settings, common) {
  const { width: minWidthIn, height: fallbackHeightIn } = paperDimensions(paper, settings.landscape);
  const size = await measureForPrint(target, printablePx(minWidthIn), printablePx(fallbackHeightIn));
  const { paperWidth, paperHeight } = continuousPaper({ minWidthIn, ...size });
  const params = { ...common, landscape: false, paperWidth, marginTop: MARGIN_IN, marginBottom: MARGIN_IN,
    marginLeft: MARGIN_IN, marginRight: MARGIN_IN };

  let height = paperHeight;
  let data;
  for (let attempt = 1; attempt <= CONTINUOUS_ATTEMPTS; attempt++) {
    data = await printToPdf(target, { ...params, paperHeight: height });
    const pages = countPdfPages(atob(data));
    if (pages <= 1) break;
    // First retry: a little taller, for a small overflow. Then tall enough for every page printed.
    height = Math.ceil(attempt === 1 ? height * 1.1 + 1 : height * pages);
  }
  return data;
}

/**
 * Lay the page out with print styles at `widthPx` CSS pixels wide and return its content size.
 * The emulation is cleared afterwards. On failure it returns one paper page's height, and the retries in
 * printContinuous grow the page from there.
 */
async function measureForPrint(target, widthPx, fallbackHeightPx) {
  const send = (method, params) => chrome.debugger.sendCommand(target, method, params);
  try {
    await send("Emulation.setEmulatedMedia", { media: "print" });
    await send("Emulation.setDeviceMetricsOverride", { width: widthPx, height: 0, deviceScaleFactor: 0, mobile: false });
    const result = await send("Runtime.evaluate", { expression: MEASURE_EXPRESSION, returnByValue: true });
    const value = result?.result?.value;
    if (!value || !(value.height > 0)) throw new Error("no size returned");
    return { contentWidthPx: Math.max(widthPx, value.width), contentHeightPx: value.height };
  } catch (err) {
    console.warn("Measuring the page failed:", errorText(err));
    return { contentWidthPx: widthPx, contentHeightPx: fallbackHeightPx };
  } finally {
    await send("Emulation.clearDeviceMetricsOverride").catch(() => {});
    await send("Emulation.setEmulatedMedia", { media: "" }).catch(() => {});
  }
}

/**
 * Page code: the document's content size. scrollHeight never reports less than the window height,
 * so for a short page the <html> box height is used instead.
 */
const MEASURE_EXPRESSION = `(() => {
  const de = document.documentElement;
  const body = document.body;
  let height = Math.max(de.getBoundingClientRect().height, body ? body.scrollHeight : 0);
  if (de.scrollHeight > window.innerHeight + 1) height = Math.max(height, de.scrollHeight);
  return { width: Math.ceil(de.scrollWidth), height: Math.ceil(height) };
})()`;

/**
 * Reveal collapsed text (line clamps, "see more" buttons, <details>, accordions) so it prints.
 * Best effort: a failure or timeout is logged and the save goes ahead with the page as it is.
 */
async function expandContent(target) {
  const evaluate = chrome.debugger.sendCommand(target, "Runtime.evaluate", {
    expression: buildExpandExpression(),
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), EXPAND_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([evaluate, timeout]);
    if (result?.exceptionDetails) {
      console.warn("Expanding content failed:", result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
  } catch (err) {
    console.warn("Expanding content failed:", errorText(err));
  } finally {
    clearTimeout(timer);
  }
}

async function downloadBase64(base64, filename, conflict) {
  const blobUrl = await makeBlobUrl(base64);
  try {
    const downloadId = await chrome.downloads.download({
      url: blobUrl,
      filename,
      conflictAction: conflict === "overwrite" ? "overwrite" : "uniquify",
      saveAs: false,
    });
    if (downloadId == null) throw new Error(chrome.runtime.lastError?.message ?? "Download didn't start.");
    await waitForDownload(downloadId);
    const [item] = await chrome.downloads.search({ id: downloadId });
    return item?.filename || filename;
  } finally {
    revokeBlobUrl(blobUrl);
  }
}

function waitForDownload(downloadId) {
  return new Promise((resolve, reject) => {
    const finish = (fn, value) => {
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(onChanged);
      fn(value);
    };
    const onChanged = (delta) => {
      if (delta.id !== downloadId || !delta.state) return;
      if (delta.state.current === "complete") finish(resolve);
      else if (delta.state.current === "interrupted") {
        finish(reject, new Error(`Download failed: ${delta.error?.current ?? "interrupted"}`));
      }
    };
    const timer = setTimeout(() => finish(reject, new Error("Timed out waiting for the download.")), DOWNLOAD_TIMEOUT_MS);
    chrome.downloads.onChanged.addListener(onChanged);
    // The download may have finished before the listener was added.
    chrome.downloads.search({ id: downloadId }).then(([item]) => {
      if (item?.state === "complete") finish(resolve);
      else if (item?.state === "interrupted") finish(reject, new Error(`Download failed: ${item.error ?? "interrupted"}`));
    });
  });
}

// ---------------------------------------------------------------------------
// Offscreen document (Blob URLs)

let creatingOffscreen = null;

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  if (contexts.length > 0) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: ["BLOBS"],
        justification: "Turn generated PDF bytes into a Blob URL for chrome.downloads.",
      })
      .finally(() => {
        creatingOffscreen = null;
      });
  }
  await creatingOffscreen;
}

async function makeBlobUrl(base64) {
  await ensureOffscreen();
  let reply;
  try {
    reply = await chrome.runtime.sendMessage({ target: "offscreen", type: "make-blob-url", base64 });
  } catch (err) {
    throw new Error(`Couldn't hand the PDF to the offscreen page (it may be too large): ${errorText(err)}`);
  }
  if (!reply?.url) throw new Error(reply?.error ?? "Couldn't create a Blob URL for the PDF.");
  return reply.url;
}

function revokeBlobUrl(url) {
  chrome.runtime.sendMessage({ target: "offscreen", type: "revoke-blob-url", url }).catch(() => {});
}

// ---------------------------------------------------------------------------

function errorText(err) {
  return err?.message ?? String(err);
}
