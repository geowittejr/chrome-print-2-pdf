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
