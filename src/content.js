// Content script: draws the "Save PDF" button. Self-contained (no imports).
(() => {
  if (window.top !== window) return;
  if (window.__savePdfButtonLoaded) return;
  window.__savePdfButtonLoaded = true;

  const LABELS = { idle: "Save PDF", saving: "Saving...", saved: "Saved", failed: "Failed" };
  const SAVED_MS = 2000;
  const FAILED_MS = 4000;

  let host = null; // shadow host element while shown
  let button = null;
  let resetTimer = null;

  const STYLE = `
    :host {
      all: initial;
      position: fixed !important;
      top: 8px !important;
      z-index: 2147483647 !important;
      opacity: 0.6;
      transition: opacity 120ms ease;
    }
    :host(:hover) { opacity: 1; }
    :host([data-position="top-left"]) { left: 8px; }
    :host([data-position="top-right"]) { right: 8px; }
    :host([data-position="top-center"]) { left: 50%; transform: translateX(-50%); }
    @media print { :host { display: none !important; } }
    button {
      font: 600 12px/1 system-ui, -apple-system, "Segoe UI", sans-serif;
      color: #fff;
      background: #1a73e8;
      border: none;
      border-radius: 999px;
      padding: 6px 12px;
      cursor: pointer;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
      white-space: nowrap;
    }
    button:disabled { cursor: progress; background: #5f6368; }
    button[data-state="saved"] { background: #188038; }
    button[data-state="failed"] { background: #c5221f; }
  `;

  function show(position) {
    if (!host) {
      host = document.createElement("save-pdf-button");
      const root = host.attachShadow({ mode: "closed" });
      const style = document.createElement("style");
      style.textContent = STYLE;
      button = document.createElement("button");
      button.type = "button";
      button.addEventListener("click", onClick);
      root.append(style, button);
      setState("idle");
      document.documentElement.append(host);
    }
    host.dataset.position = position || "top-center";
  }

  function hide() {
    host?.remove();
    host = null;
    button = null;
    clearTimeout(resetTimer);
  }

  function setState(state, tooltip = "") {
    if (!button) return;
    button.dataset.state = state;
    button.textContent = LABELS[state];
    button.title = tooltip;
    button.disabled = state === "saving";
  }

  async function onClick() {
    clearTimeout(resetTimer);
    setState("saving");
    let result;
    try {
      result = await chrome.runtime.sendMessage({ type: "save-pdf" });
    } catch (err) {
      result = { ok: false, error: err?.message ?? String(err) };
    }
    if (result?.ok) {
      setState("saved", result.path);
      resetTimer = setTimeout(() => setState("idle"), SAVED_MS);
    } else {
      setState("failed", result?.error ?? "Unknown error");
      resetTimer = setTimeout(() => setState("idle"), FAILED_MS);
    }
  }

  async function refresh() {
    try {
      const state = await chrome.runtime.sendMessage({ type: "get-button-state" });
      if (state?.show) show(state.position);
      else hide();
    } catch {
      // Extension was reloaded or the worker is unavailable; leave the page alone.
      hide();
    }
  }

  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === "local") refresh();
  });

  refresh();
})();
