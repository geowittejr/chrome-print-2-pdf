# Notes

Open questions and decisions made while building, per the plan's instructions.

## Build process

- All four phases were built in one pass, because the request was to execute the plan and open a PR. The plan
  asks to stop after each phase for manual checks; those checks are listed in the PR description and still
  need to be run in Chrome. The Phase 1 interim behaviour (toolbar click saves `Downloads/test.pdf`) was
  never shipped, since Phase 3 replaces it with the popup.
- `npm test` runs `node --test` with no path, so Node picks up `tests/*.test.js`. (`node --test tests/` fails
  on Node 24, which treats the directory argument as a file.)
- The Phase 1 automated check ("manifest.json parses, and every file it names exists") is a test in
  `tests/manifest.test.js`, so it runs with every `npm test`.

## Additions beyond the file list

- `lib/settings.js` also exports `canCapture(url)`, `normalizeHost`, `parseBlocklist`, `PAPER_SIZES` and
  `saveSettings`. `canCapture` is shared by the worker and popup so "can't be saved" is decided in one place.
  It allows `http:`, `https:` and `file:` and rejects the Chrome Web Store hosts.
- `lib/naming.js` also exports `hostFromUrl` and `removeForbidden`.
- The popup sends its tab id with `save-pdf` so it saves the tab it was opened on; without one, the worker
  falls back to the active tab of the last focused window.

## Expanding collapsed text

- Runs in `printTab` through the debugger that is already attached (`Runtime.evaluate` with `userGesture`), so no
  `scripting` permission was added. The page code is `expandHiddenContent` in `lib/expand.js`, sent as a string.
- Order: lift clamps and height limits, open `<details>`, click `aria-expanded="false"` and Bootstrap collapse
  toggles, click "show more"-style buttons, wait for the DOM to go quiet (500 ms, max 4 s), repeat clicks up to 3
  rounds, then lift clamps again. Capped at 200 clicks and 15 s overall; a failure is logged and the save goes on.
- Never clicked: links with a real `href`, submit buttons in forms, `aria-haspopup`, menu/tab/combobox roles,
  anything inside `nav`, `header`, `footer`, dialogs or toolbars, and labels with words like "load", "comments",
  "jobs", "less" or "hide" (see `SKIP_LABEL`).
- Known limits: exclusive accordions close one panel when the next opens, so only the last stays open. The
  "…see more" button still appears in the PDF after its text is unclamped. Button wording is English only;
  unclamping works in any language. Unclamping can enlarge overflow-hidden boxes that crop images if they also
  contain text. The page is not restored after saving.

## Continuous (single-page) PDFs

- On by default (`continuous` setting). Removes the blank gaps that page breaks leave when the browser pushes a
  block that won't fit to the next page.
- Uses the debugger that is already attached, after expanding content: emulate `print` media and set the
  viewport to the paper's printable width (`Emulation.setDeviceMetricsOverride`), measure the document height
  in the page, clear both, then `Page.printToPDF` with that height and 0.4 in margins. `lib/pagesize.js` holds
  the size maths.
- Print layout can differ from the measurement, so the worker counts `/Type /Page` objects in the result. With
  more than one page it prints again taller (x1.1 + 1 in, then x page count), at most 3 prints in all.
- Known limits: elements sized in `vh` grow to the tall page's height in print, which can leave blank space or
  keep a second page. Very tall pages (over 200 in) are valid PDF but some viewers, Acrobat among them, cap
  page size at 200 in. Pages that scroll inside an inner container rather than the document still print only
  what that container shows, as before.

## Features To Consider

- **Print to Markdown, HTML, or PDF** - present the option to choose the format.
- **Select Content Container** - allow the user to select the content container to print
  - [Find the main content body in a web page](https://share.google/aimode/Nc97fyBuRlWX91j8N)
- **Use React, Vite, Tailwind CSS** - hit all the latest tech that I care about
  - [Create Extension Using React](https://share.google/aimode/blmy4rfn3PkK6OSfb)

## Open questions / to verify in Chrome

- **Debugger bar**: how long it stays after detach, and whether `--silent-debugger-extension-api` hides it.
  (Phase 1 manual check — not yet run.)
- **"Ask where to save each file"**: whether `saveAs: false` suppresses the prompt when this Chrome setting is
  on. (Phase 1 manual check — not yet run.)
- **Built-in PDF viewer**: `canCapture` can't tell a PDF-viewer tab from a normal page by URL, so the popup
  offers "Save this page" there; the save then fails with the debugger's error message. The content script
  doesn't run in the viewer, so no button appears.
- **`file:` URLs**: capture needs "Allow access to file URLs" on the extension's details page. The `{domain}`
  token is empty for `file:` pages, so `buildFileName` falls back to the title `page` when both the title and
  host are empty (otherwise the default template would give `20261115-130642..pdf`). This fallback is not in
  the plan.
- **Windows reserved names** (`CON`, `NUL`, `COM1`…) are not filtered from folder segments or file names.
  `chrome.downloads` should reject them with an error, which is shown to the user.
- **Icons**: the plan lists none, so Chrome shows its default letter icon.
- **Large PDFs**: the base64 travels in one runtime message. A failure surfaces as "Couldn't hand the PDF to
  the offscreen page (it may be too large)". No chunking, per the plan.
- **DevTools open on the tab**: attaching fails when another debugger is attached; the error is shown as-is.
