// Settings. DEFAULTS, isBlocked and canCapture are pure; getSettings/saveSettings use chrome.storage.

export const DEFAULTS = Object.freeze({
  enabled: true,
  blocklist: [],
  folder: "__ChromePrint2PDF",
  template: "{timestamp}.{title}.pdf",
  timestampFormat: "yyyyMMdd-HHmmss",
  conflict: "uniquify",
  position: "top-left",
  paper: "letter",
  landscape: false,
  printBackground: true,
  headerFooter: false,
  expandContent: true,
  continuous: true,
  /** Extra space below the content on a continuous page, in inches. */
  bottomMargin: 0.5,
  /** Longest wait for expanding collapsed text before printing anyway, in seconds. */
  expandTimeout: 5,
});

/** Paper sizes in inches for Page.printToPDF paperWidth/paperHeight. */
export const PAPER_SIZES = Object.freeze({
  letter: { width: 8.5, height: 11 },
  a4: { width: 8.27, height: 11.69 },
  legal: { width: 8.5, height: 14 },
});

export const POSITIONS = Object.freeze(["top-left", "top-center", "top-right"]);
export const CONFLICT_ACTIONS = Object.freeze(["uniquify", "overwrite"]);

/** Lower case, trimmed, leading "www." removed. */
export function normalizeHost(host) {
  return String(host ?? "").trim().toLowerCase().replace(/^www\./, "");
}

/** True when `host` equals a blocklist entry or is a subdomain of one. */
export function isBlocked(host, blocklist) {
  const h = normalizeHost(host);
  if (!h || !Array.isArray(blocklist)) return false;
  return blocklist.some((entry) => {
    const e = normalizeHost(entry);
    return e !== "" && (h === e || h.endsWith("." + e));
  });
}

/** Turn the options-page textarea (one host per line) into a clean blocklist. */
export function parseBlocklist(text) {
  const seen = new Set();
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const host = normalizeHost(line);
    if (host) seen.add(host);
  }
  return [...seen];
}

/**
 * Whether Chrome lets the extension capture this URL. Chrome pages, the Web Store,
 * other extensions' pages and the built-in PDF viewer reject scripts or the debugger.
 */
export function canCapture(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (!["http:", "https:", "file:"].includes(u.protocol)) return false;
  const host = u.hostname.toLowerCase();
  if (host === "chromewebstore.google.com") return false;
  if (host === "chrome.google.com" && u.pathname.startsWith("/webstore")) return false;
  return true;
}

/** Bottom margin setting as inches between 0 and 20; anything unusable gives the default. */
export function bottomMarginInches(value) {
  return clampNumber(value, 0, 20, DEFAULTS.bottomMargin);
}

/** Expand wait setting as seconds between 0 and 60; anything unusable gives the default. */
export function expandSeconds(value) {
  return clampNumber(value, 0, 60, DEFAULTS.expandTimeout);
}

function clampNumber(value, min, max, fallback) {
  const n = typeof value === "string" && value.trim() === "" ? NaN : Number(value);
  if (value == null || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Stored values merged over DEFAULTS, so a missing key never breaks a save. */
export async function getSettings() {
  const stored = await chrome.storage.local.get(null);
  return { ...DEFAULTS, ...stored };
}

export async function saveSettings(partial) {
  await chrome.storage.local.set(partial);
}
