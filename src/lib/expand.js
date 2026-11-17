// Reveal collapsed text on the current page before printing. Never follows links to other pages.
//
// `expandHiddenContent` runs inside the page (via the debugger's Runtime.evaluate), so it must stay
// self-contained: no imports and no references to anything else in this module. Its settings,
// including the label patterns, arrive as one JSON argument.

/** Whole-label pattern for buttons that reveal more text: "see more", "…more", "Read full story". */
export const EXPAND_LABEL =
  "^[\\s.…+(\\[]*(?:(?:show|see|read|view|display|reveal|expand)\\s+(?:the\\s+)?" +
  "(?:more|full|all|rest|entire|everything)(?:\\s+[\\w'’-]+){0,3}" +
  "|more|expand(?:\\s+all)?|read\\s+on|continue\\s+reading)[\\s.…)\\]▾▼⌄›»]*$";

/** Words that mean the control loads other content, opens a menu, or collapses. Never clicked. */
export const SKIP_LABEL =
  "\\b(?:load|next|previous|prev|page|results?|jobs?|posts?|comments?|repl(?:y|ies)|items?|products?|" +
  "articles?|stories|videos?|photos?|images?|reviews?|people|members|similar|related|recommended|" +
  "menu|filters?|sort|share|settings|account|profile|language|notifications?|search|cart|options|" +
  "actions|less|fewer|hide|collapse|close)\\b";

/** Longest label (after whitespace is collapsed) treated as a button caption. */
export const MAX_LABEL_LENGTH = 60;

export const EXPAND_OPTIONS = Object.freeze({
  expandLabel: EXPAND_LABEL,
  skipLabel: SKIP_LABEL,
  maxLabelLength: MAX_LABEL_LENGTH,
  maxClicks: 200,
  rounds: 3,
  quietMs: 500,
  maxWaitMs: 4000,
  /** Stop starting new work after this long; the save goes ahead with what is expanded by then. */
  deadlineMs: 5000,
  minTextLength: 20,
});

/** Collapse whitespace and trim. */
export function normalizeLabel(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

/** True when a button caption reads like "show more text" and not like "load more" or a menu. */
export function isExpandLabel(text) {
  const label = normalizeLabel(text);
  if (!label || label.length > MAX_LABEL_LENGTH) return false;
  return new RegExp(EXPAND_LABEL, "i").test(label) && !new RegExp(SKIP_LABEL, "i").test(label);
}

/** True when a link's href leads somewhere (another page or file) rather than being a script hook. */
export function isNavigatingHref(href) {
  const h = String(href ?? "").trim();
  return h !== "" && h !== "#" && !/^javascript:/i.test(h);
}

/** The Runtime.evaluate expression that runs `expandHiddenContent` with `options`. */
export function buildExpandExpression(options = EXPAND_OPTIONS) {
  return `(${expandHiddenContent.toString()})(${JSON.stringify(options)})`;
}

/**
 * Runs in the page. In order:
 * 1. Lift line clamps, height limits and ellipsis truncation on elements hiding text.
 * 2. Open every <details> and every hidden="until-found" section.
 * 3. Click collapsed toggles (aria-expanded="false", Bootstrap collapse toggles).
 * 4. Click buttons labelled like "show more", skipping links, menus, submit buttons and "load more".
 * 5. Wait for the page to stop changing, repeat 3–4 for newly revealed toggles, then repeat 1–2.
 * Stops waiting and starts no new round once opts.deadlineMs has passed.
 * Resolves to counts of what it changed.
 */
export async function expandHiddenContent(opts) {
  const EXPAND = new RegExp(opts.expandLabel, "i");
  const SKIP = new RegExp(opts.skipLabel, "i");
  const report = { unclamped: 0, opened: 0, clicked: 0 };
  const deadline = Date.now() + (opts.deadlineMs ?? Infinity);
  const remaining = () => deadline - Date.now();
  const clicked = new WeakSet();

  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "IMG", "PICTURE", "VIDEO", "AUDIO", "CANVAS",
    "IFRAME", "SVG", "INPUT", "TEXTAREA", "SELECT", "OPTION", "HTML", "BODY",
  ]);
  const NO_CLICK_AREAS =
    'nav, header, footer, [role="navigation"], [role="menubar"], [role="menu"], [role="listbox"], ' +
    '[role="toolbar"], [role="tablist"], [role="dialog"], [aria-modal="true"], [role="search"]';
  const NO_CLICK_ROLES = new Set(["combobox", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "option", "switch", "link"]);
  const CLICKABLE = 'button, [role="button"], a, summary, [tabindex], [onclick]';

  const normalize = (t) => String(t ?? "").replace(/\s+/g, " ").trim();
  const navigates = (href) => {
    const h = String(href ?? "").trim();
    return h !== "" && h !== "#" && !/^javascript:/i.test(h);
  };
  const labelOf = (el) => normalize(el.textContent) || normalize(el.getAttribute("aria-label"));
  const isExpandText = (t) => t.length > 0 && t.length <= opts.maxLabelLength && EXPAND.test(t) && !SKIP.test(t);

  function isVisible(el) {
    if (typeof el.checkVisibility === "function") return el.checkVisibility({ visibilityProperty: true });
    return el.getClientRects().length > 0;
  }

  /** Whether clicking `el` is safe: stays on this page and doesn't open a menu, form or dialog. */
  function safeToClick(el) {
    if (clicked.has(el) || !el.isConnected || !isVisible(el)) return false;
    if (el.matches("input, select, textarea, option, [contenteditable]")) return false;
    if (el.disabled || el.getAttribute("aria-disabled") === "true") return false;
    const popup = el.getAttribute("aria-haspopup");
    if (popup && popup !== "false") return false;
    if (NO_CLICK_ROLES.has(el.getAttribute("role"))) return false;
    if (el.closest(NO_CLICK_AREAS)) return false;
    const link = el.closest("a[href]");
    if (link && navigates(link.getAttribute("href"))) return false;
    if (el.closest("[download]")) return false;
    // A plain <button> in a form submits it, which can load another page.
    if (el.tagName === "BUTTON" && el.form && (el.getAttribute("type") ?? "submit").toLowerCase() === "submit") return false;
    return true;
  }

  function click(el) {
    if (report.clicked >= opts.maxClicks) return false;
    clicked.add(el);
    try {
      el.click();
      report.clicked += 1;
      return true;
    } catch {
      return false;
    }
  }

  /** Step 1: find text cut off by line clamps, height limits or ellipsis, then lift the limits. */
  function unclamp() {
    if (!document.body) return;
    const vertical = [];
    const horizontal = [];
    // Read everything first and write afterwards, so the page lays out once instead of per element.
    for (const el of document.body.querySelectorAll("*")) {
      if (SKIP_TAGS.has(el.tagName.toUpperCase()) || el.closest("svg")) continue;
      if (el.clientWidth < 2 || el.clientHeight < 2) continue; // collapsed or screen-reader-only
      const cs = getComputedStyle(el);
      if (cs.position === "fixed" || cs.position === "sticky") continue;
      if (cs.clip !== "auto" && cs.clip !== "") continue;
      const clamp = cs.webkitLineClamp && cs.webkitLineClamp !== "none";
      const cutOffBelow = cs.overflowY !== "visible" && el.scrollHeight > el.clientHeight + 2;
      const cutOffRight = cs.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1;
      if (!clamp && !cutOffBelow && !cutOffRight) continue;
      if (normalize(el.textContent).length < opts.minTextLength) continue;
      if (clamp || cutOffBelow) vertical.push(el);
      if (cutOffRight) horizontal.push(el);
    }
    const set = (el, prop, value) => el.style.setProperty(prop, value, "important");
    for (const el of vertical) {
      set(el, "-webkit-line-clamp", "none");
      set(el, "line-clamp", "none");
      set(el, "max-height", "none");
      set(el, "height", "auto");
      set(el, "overflow-y", "visible");
    }
    for (const el of horizontal) {
      set(el, "white-space", "normal");
      set(el, "text-overflow", "clip");
      set(el, "overflow-x", "visible");
    }
    report.unclamped += new Set([...vertical, ...horizontal]).size;
  }

  /** Step 2: built-in HTML disclosure. */
  function openNative() {
    for (const d of document.querySelectorAll("details:not([open])")) {
      d.open = true;
      report.opened += 1;
    }
    for (const el of document.querySelectorAll('[hidden="until-found"]')) {
      el.removeAttribute("hidden");
      report.opened += 1;
    }
  }

  /** Step 3: toggles that say they are collapsed. */
  function clickCollapsedToggles() {
    let count = 0;
    const toggles = document.querySelectorAll(
      '[aria-expanded="false"], [data-bs-toggle="collapse"]:not([aria-expanded="true"]), [data-toggle="collapse"]:not([aria-expanded="true"])',
    );
    for (const el of toggles) {
      if (el.matches("details > summary")) continue; // opened in step 2
      if (!safeToClick(el)) continue;
      if (SKIP.test(labelOf(el))) continue;
      if (click(el)) count += 1;
    }
    return count;
  }

  /** Step 4: buttons whose caption reads like "show more". */
  function clickMoreButtons() {
    let count = 0;
    const seen = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (/more|full|expand|rest|read|continu/i.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const target = clickableFor(node.parentElement);
      if (!target || seen.has(target)) continue;
      seen.add(target);
      if (target.getAttribute("aria-expanded") === "true") continue;
      if (!isExpandText(labelOf(target))) continue;
      if (!safeToClick(target)) continue;
      if (click(target)) count += 1;
    }
    // Icon-only or text-less buttons that carry their caption in aria-label.
    for (const el of document.querySelectorAll('button[aria-label], [role="button"][aria-label]')) {
      if (seen.has(el) || normalize(el.textContent)) continue;
      if (!isExpandText(normalize(el.getAttribute("aria-label")))) continue;
      if (el.getAttribute("aria-expanded") === "true" || !safeToClick(el)) continue;
      if (click(el)) count += 1;
    }
    return count;
  }

  /** The element a "more" caption belongs to: a real control, or a nearby element styled as clickable. */
  function clickableFor(el) {
    if (!el) return null;
    const control = el.closest(CLICKABLE);
    if (control) return control;
    for (let e = el, depth = 0; e && e !== document.body && depth < 3; e = e.parentElement, depth += 1) {
      if (getComputedStyle(e).cursor === "pointer") return e;
    }
    return null;
  }

  /** Resolve once the DOM has been quiet for quietMs, or after maxWaitMs at most. */
  function settle() {
    return new Promise((resolve) => {
      let quiet;
      const done = () => {
        observer.disconnect();
        clearTimeout(quiet);
        clearTimeout(cap);
        resolve();
      };
      const observer = new MutationObserver(() => {
        clearTimeout(quiet);
        quiet = setTimeout(done, opts.quietMs);
      });
      observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      quiet = setTimeout(done, opts.quietMs);
      const cap = setTimeout(done, Math.max(0, Math.min(opts.maxWaitMs, remaining())));
    });
  }

  unclamp();
  openNative();
  for (let round = 0; round < opts.rounds && report.clicked < opts.maxClicks && remaining() > 0; round += 1) {
    const clicks = clickCollapsedToggles() + clickMoreButtons();
    if (clicks === 0) break;
    await settle();
  }
  // Clicks can reveal content that is itself clamped or collapsed.
  if (report.clicked > 0) {
    unclamp();
    openNative();
  }
  return report;
}
