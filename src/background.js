// Service worker: message router and the save pipeline.
import { buildFileName, hostFromUrl, validateFolder } from "./lib/naming.js";
import { PAPER_SIZES, DEFAULTS, canCapture, getSettings, isBlocked } from "./lib/settings.js";

const OFFSCREEN_URL = "offscreen.html";
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

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
    const result = await chrome.debugger.sendCommand(target, "Page.printToPDF", {
      landscape: Boolean(settings.landscape),
      displayHeaderFooter: Boolean(settings.headerFooter),
      printBackground: Boolean(settings.printBackground),
      paperWidth: paper.width,
      paperHeight: paper.height,
      transferMode: "ReturnAsBase64",
    });
    if (!result?.data) throw new Error("Chrome returned no PDF data.");
    return result.data;
  } finally {
    await chrome.debugger.detach(target).catch(() => {});
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
