// Pure file-naming helpers. No chrome.* calls, so Node can test this module.

// Characters a file name can't hold on Windows (and therefore anywhere we save).
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

const MAX_TITLE_LENGTH = 100;

const pad2 = (n) => String(n).padStart(2, "0");

/** Host name in lower case without a leading "www.". Empty string if the URL has no host. */
export function hostFromUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Remove characters that file names can't hold. */
export function removeForbidden(text) {
  return String(text ?? "").replace(FORBIDDEN, "");
}

/**
 * Format a Date in local time. Tokens: yyyy yy MM dd HH mm ss.
 * Tokens are matched in one pass, longest first; every other character is kept,
 * then forbidden file-name characters are removed.
 */
export function formatTimestamp(date, format) {
  const values = {
    yyyy: String(date.getFullYear()).padStart(4, "0"),
    yy: pad2(date.getFullYear() % 100),
    MM: pad2(date.getMonth() + 1),
    dd: pad2(date.getDate()),
    HH: pad2(date.getHours()),
    mm: pad2(date.getMinutes()),
    ss: pad2(date.getSeconds()),
  };
  const formatted = String(format ?? "").replace(/yyyy|yy|MM|dd|HH|mm|ss/g, (token) => values[token]);
  return removeForbidden(formatted);
}

const trimEnds = (text, chars) => {
  const set = new Set(chars);
  let start = 0;
  let end = text.length;
  while (start < end && set.has(text[start])) start++;
  while (end > start && set.has(text[end - 1])) end--;
  return text.slice(start, end);
};

const trimEnd = (text, chars) => {
  const set = new Set(chars);
  let end = text.length;
  while (end > 0 && set.has(text[end - 1])) end--;
  return text.slice(0, end);
};

/**
 * Clean a page title for use in a file name. Falls back to `fallbackHost`
 * (www. stripped) when nothing usable is left.
 */
export function cleanTitle(title, fallbackHost = "") {
  let text = removeForbidden(title);
  text = text.replace(/\s+/g, "-");
  text = text.replace(/-{2,}/g, "-");
  text = trimEnds(text, "-. ");
  text = text.slice(0, MAX_TITLE_LENGTH);
  text = trimEnd(text, "-.");
  if (!text) {
    text = String(fallbackHost ?? "").toLowerCase().replace(/^www\./, "");
  }
  return text;
}

/**
 * Build the file name from the template.
 * Tokens: {timestamp} {title} {domain} {date} {time}. Unknown tokens stay as typed.
 */
export function buildFileName({ title, url, date, template, timestampFormat }) {
  const domain = hostFromUrl(url);
  const tokens = {
    timestamp: formatTimestamp(date, timestampFormat),
    // file: URLs have no host, so fall back to "page" rather than an empty title.
    title: cleanTitle(title, domain || "page"),
    domain,
    date: formatTimestamp(date, "yyyy-MM-dd"),
    time: formatTimestamp(date, "HHmmss"),
  };
  let name = String(template ?? "").replace(/\{(\w+)\}/g, (whole, key) =>
    Object.hasOwn(tokens, key) ? tokens[key] : whole,
  );
  name = removeForbidden(name);
  name = trimEnd(name, ". ");
  if (!/\.pdf$/i.test(name)) name += ".pdf";
  return name;
}

/**
 * Validate the save folder, a path relative to Downloads.
 * Returns {ok: true, value} or {ok: false, error}.
 */
export function validateFolder(input) {
  const text = String(input ?? "").trim().replace(/\\/g, "/");
  const outside = { ok: false, error: "Folder must be inside Downloads." };
  if (text.startsWith("/") || /^[a-zA-Z]:/.test(text)) return outside;
  const rawSegments = text.split("/");
  if (rawSegments.some((s) => s.trim() === "..")) return outside;
  const segments = rawSegments
    .map((s) => trimEnds(removeForbidden(s), " ."))
    .filter((s) => s !== "" && s !== ".");
  return { ok: true, value: segments.join("/") };
}
