import { hostFromUrl } from "./lib/naming.js";
import { canCapture, getSettings, isBlocked, normalizeHost, saveSettings } from "./lib/settings.js";

const $ = (id) => document.getElementById(id);

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const settings = await getSettings();
  const url = tab?.url ?? "";
  const host = hostFromUrl(url);
  const capturable = Boolean(tab) && canCapture(url);

  $("enabled").checked = settings.enabled;
  $("enabled").addEventListener("change", (e) => saveSettings({ enabled: e.target.checked }));

  const hideBox = $("hide-site");
  if (capturable && host) {
    hideBox.checked = isBlocked(host, settings.blocklist);
    hideBox.addEventListener("change", (e) => toggleHostBlocked(host, e.target.checked));
  } else {
    hideBox.disabled = true;
    $("hide-label").classList.add("disabled");
  }

  if (capturable) {
    $("save").hidden = false;
    $("save").addEventListener("click", () => save(tab.id));
  } else {
    $("unsupported").hidden = false;
  }

  $("options").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

async function toggleHostBlocked(host, block) {
  const { blocklist } = await getSettings();
  const h = normalizeHost(host);
  let next;
  if (block) {
    next = blocklist.includes(h) ? blocklist : [...blocklist, h];
  } else {
    // Remove the host and any parent entry that blocks it, so the button comes back here.
    next = blocklist.filter((entry) => !isBlocked(h, [entry]));
  }
  await saveSettings({ blocklist: next });
}

async function save(tabId) {
  const button = $("save");
  const status = $("status");
  button.disabled = true;
  button.textContent = "Saving...";
  status.className = "";
  status.textContent = "";
  let result;
  try {
    result = await chrome.runtime.sendMessage({ type: "save-pdf", tabId });
  } catch (err) {
    result = { ok: false, error: err?.message ?? String(err) };
  }
  button.disabled = false;
  button.textContent = "Save this page";
  if (result?.ok) {
    status.className = "ok";
    status.textContent = `Saved: ${result.path}`;
  } else {
    status.className = "error";
    status.textContent = result?.error ?? "Unknown error";
  }
}

init();
