import { buildFileName, validateFolder } from "./lib/naming.js";
import { DEFAULTS, getSettings, parseBlocklist, saveSettings } from "./lib/settings.js";

const $ = (id) => document.getElementById(id);

const SAMPLE_TITLE = "Senior Software Engineer - Acme Careers";
const SAMPLE_URL = "https://www.example.com/jobs/123";

const CHECKBOXES = ["enabled", "landscape", "printBackground", "headerFooter", "expandContent"];
const SELECTS = ["position", "conflict", "paper"];
const TEXTS = ["template", "timestampFormat"];

async function init() {
  const settings = await getSettings();

  for (const key of CHECKBOXES) {
    $(key).checked = Boolean(settings[key]);
    $(key).addEventListener("change", (e) => saveSettings({ [key]: e.target.checked }));
  }
  for (const key of SELECTS) {
    $(key).value = settings[key];
    $(key).addEventListener("change", (e) => saveSettings({ [key]: e.target.value }));
  }
  for (const key of TEXTS) {
    $(key).value = settings[key];
    $(key).addEventListener("input", (e) => {
      saveSettings({ [key]: e.target.value });
      updatePreview();
    });
  }

  $("folder").value = settings.folder;
  $("folder").addEventListener("input", onFolderInput);

  $("blocklist").value = settings.blocklist.join("\n");
  $("blocklist").addEventListener("change", (e) => {
    const list = parseBlocklist(e.target.value);
    e.target.value = list.join("\n");
    saveSettings({ blocklist: list });
  });

  // Keep the blocklist and switch in sync when the popup changes them.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.blocklist && document.activeElement !== $("blocklist")) {
      $("blocklist").value = (changes.blocklist.newValue ?? []).join("\n");
    }
    if (changes.enabled) $("enabled").checked = Boolean(changes.enabled.newValue ?? DEFAULTS.enabled);
  });

  updatePreview();
}

function onFolderInput(e) {
  const result = validateFolder(e.target.value);
  const error = $("folder-error");
  if (result.ok) {
    e.target.classList.remove("invalid");
    error.hidden = true;
    saveSettings({ folder: result.value });
  } else {
    e.target.classList.add("invalid");
    error.textContent = result.error;
    error.hidden = false;
  }
  updatePreview();
}

function updatePreview() {
  const name = buildFileName({
    title: SAMPLE_TITLE,
    url: SAMPLE_URL,
    date: new Date(),
    template: $("template").value || DEFAULTS.template,
    timestampFormat: $("timestampFormat").value,
  });
  $("preview").textContent = name;
  const folder = validateFolder($("folder").value);
  $("saves-to").textContent = folder.ok
    ? `Saves to: Downloads/${folder.value ? folder.value + "/" : ""}${name}`
    : "Saves to: (fix the folder above)";
}

init();
