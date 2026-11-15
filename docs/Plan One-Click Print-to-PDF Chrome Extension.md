# Plan: One-Click Print-to-PDF Chrome Extension

Nov 15, 2026 · @George

## Summary

Build a Manifest V3 Chrome extension, loaded unpacked for personal use, that puts a "Save PDF" button at the top of every site. One click renders the current tab to PDF and saves it under a configurable folder inside Downloads, with no print dialog.

This is a build spec for Claude Code. It runs phase by phase, and each phase ends with checks that define done.

The build is plain JavaScript with no dependencies, no build step and no native helper. It targets Chrome on Windows and uses nothing Windows-specific, so it should run unchanged on Linux.

## Decisions

These five answers are settled, and the rest of the spec follows from them.

| Question | Decision | Effect on the build |
| --- | --- | --- |
| Operating system | Windows now, Linux possible later | Paths use forward slashes. File names avoid Windows-forbidden characters on every platform. |
| Save location | Inside Downloads only | The folder setting is a relative path under Downloads. No native helper. |
| Helper language | Node, if a helper is ever added | Out of scope here. Notes sit under Not in this build. |
| Where the button shows | Every site once switched on, minus a blocklist | One master switch plus a list of blocked sites. |
| Timestamp | `yyyyMMdd-HHmmss` by default | The format is a setting. |

## Instructions for Claude Code

Build the phases in order and stop after each one, because the manual checks need a person in Chrome.

- Create the project in a new folder named `save-pdf-extension`.
- Use plain JavaScript ES modules. No TypeScript, bundler, framework or npm dependencies.
- Load the service worker as a module (`"type": "module"`). Keep `content.js` a single self-contained script, since content scripts can't use static imports.
- Use the promise forms of the `chrome.*` APIs with `async` and `await`.
- Keep `lib/naming.js` and the pure parts of `lib/settings.js` free of `chrome.*` calls so Node can test them.
- Run unit tests with Node's built-in runner, `node --test`. Every row of the test table under File naming becomes a test.
- Check each `chrome.*` call and each `Page.printToPDF` parameter against the pages under Sources before using it.
- Build only what this spec lists. Write anything unclear or surprising to `NOTES.md` instead of guessing silently.
- At the end of each phase, run the tests, then list that phase's manual checks for George and wait.

## What Chrome allows

Chrome will generate the PDF silently, but it restricts where an extension can write the file. Each need maps to one API.

| Need | API | What you get | Catch |
| --- | --- | --- | --- |
| Generate the PDF with no dialog | [`chrome.debugger`](https://developer.chrome.com/docs/extensions/reference/api/debugger?hl=en) sending the DevTools command `Page.printToPDF` | PDF bytes as base64, with paper size, orientation and backgrounds as options | Needs the `debugger` permission. Expect Chrome's "started debugging this browser" bar while attached. |
| Turn the bytes into a URL | [`chrome.offscreen`](https://developer.chrome.com/docs/extensions/reference/api/offscreen?hl=en) document created with reason `BLOBS` | A Blob URL the downloads API can fetch | Service workers have no `URL.createObjectURL`, so a hidden page makes the URL. It talks to the worker through `chrome.runtime` messages. |
| Save the file | [`chrome.downloads.download`](https://developer.chrome.com/docs/extensions/reference/api/downloads?hl=en) | A file at `Downloads/<folder>/<name>.pdf` | The path must be relative to Downloads. Absolute paths and `..` cause an error. |

A `data:` URL would skip the offscreen page, but an image-heavy page can produce a PDF too large for one URL. The Blob route is the only save path, so there is one code path to test.

Alternatives considered and dropped:

- **`window.print()`** opens the print dialog every time, so the destination and path are picked by hand.
- **`chrome.printing`** is ChromeOS-only and **`tabs.saveAsPDF`** is Firefox-only.
- **A native helper** would allow folders outside Downloads. It isn't needed, since Downloads is enough.

## Architecture

The service worker does all the work. The button, popup and options page only send it messages or edit settings.

&#91;embedded content: save flow · 6 parts, one save path\]

The worker asks Chrome to render the tab as a PDF, then saves the bytes under the Downloads folder. The button also takes its on/off state and blocklist from the same settings, by asking the worker.

### Files

| File | Job |
| --- | --- |
| `manifest.json` | Manifest V3. Permissions `debugger`, `downloads`, `storage`, `offscreen`. Host permission `<all_urls>`. Module service worker. Content script on `<all_urls>`, top frame only, at `document_idle`. Action popup, options page, and a `save-pdf` command suggested as Alt+Shift+S. |
| `background.js` | Message router and the save pipeline below. |
| `content.js` | Draws and removes the button, sends `save-pdf`, shows the result. |
| `offscreen.html`, `offscreen.js` | Turns base64 into a Blob URL and revokes it later. |
| `popup.html`, `popup.js` | Master switch, "Hide on this site", "Save this page", link to options. |
| `options.html`, `options.js` | Every setting, with a live file-name preview and a "Saves to" line. |
| `lib/naming.js` | Pure functions: `formatTimestamp`, `cleanTitle`, `buildFileName`, `validateFolder`. |
| `lib/settings.js` | `DEFAULTS`, `getSettings()`, and the pure `isBlocked(host, blocklist)`. |
| `tests/naming.test.js`, `tests/settings.test.js` | `node --test` suites. |
| `package.json`, `README.md`, `NOTES.md` | `"type": "module"` and a `test` script; load-unpacked steps; open questions found while building. |

### Save pipeline

`background.js` runs these steps for one tab. Each failure returns `{ok: false, error}` with a message a person can read.

1. Accept `save-pdf` from the content script (tab is `sender.tab`), the popup, or the keyboard command (both use the active tab).
2. Refuse if a save is already running for that tab.
3. Read settings, then the tab's title and URL with `chrome.tabs.get`.
4. Build the relative path: validated folder, a slash, and `buildFileName(...)`.
5. Call `chrome.debugger.attach({tabId}, "1.3")`, send `Page.printToPDF` with the PDF settings, and detach in a `finally` block.
6. Create the offscreen document if none exists, send it the base64, and get back a Blob URL.
7. Call `chrome.downloads.download` with `url`, `filename`, `conflictAction` and `saveAs: false`.
8. Wait for `chrome.downloads.onChanged` to report `complete` or `interrupted`, then have the offscreen page revoke the URL.
9. Reply `{ok: true, path}` using the final path from `chrome.downloads.search`.

### Messages

| Message | From, to | Reply |
| --- | --- | --- |
| `get-button-state` | Content script to worker | `{show, position}` |
| `save-pdf` | Content script or popup to worker | `{ok: true, path}` or `{ok: false, error}` |
| `make-blob-url` with `base64` | Worker to offscreen page | `{url}` |
| `revoke-blob-url` with `url` | Worker to offscreen page | `{ok: true}` |

Messages for the offscreen page carry `target: "offscreen"`, and every listener ignores messages not meant for it. Listeners that reply later return `true` and call `sendResponse`.

## Settings

Eleven settings, all stored in `chrome.storage.local` under the keys below. `getSettings()` merges stored values over `DEFAULTS`, so a missing key never breaks a save.

| Setting | Key | Default | Rules | Phase |
| --- | --- | --- | --- | --- |
| Show the button | `enabled` | `true` | Master switch. Also in the popup. | 3 |
| Blocked sites | `blocklist` | `[]` | Host names, one per line in the options page. | 3 |
| Save folder | `folder` | `PDFs` | Relative path under Downloads. Nested paths such as `Work/PDFs` are allowed. Empty means Downloads itself. | 2 |
| File name template | `template` | `{timestamp}.{title}.pdf` | Tokens under File naming. | 2 |
| Timestamp format | `timestampFormat` | `yyyyMMdd-HHmmss` | Format tokens under File naming. Local time. | 2 |
| If the file exists | `conflict` | `uniquify` | `uniquify` adds a counter. `overwrite` replaces the file. | 2 |
| Button position | `position` | `top-center` | `top-left`, `top-center` or `top-right`. | 3 |
| Paper size | `paper` | `letter` | `letter`, `a4` or `legal`, mapped to `paperWidth` and `paperHeight` in inches. | 4 |
| Landscape | `landscape` | `false` |  | 4 |
| Print backgrounds | `printBackground` | `true` |  | 4 |
| Header and footer | `headerFooter` | `false` | Maps to `displayHeaderFooter`. | 4 |

The options page saves on change, shows a live preview of the file name for a sample title, and shows a "Saves to: Downloads/..." line. An invalid folder shows an inline error and is not saved.

### Button and popup behavior

- The button shows when `enabled` is true, the page is the top frame, and the host is not blocked.
- A blocklist entry blocks that host and its subdomains. Compare in lower case with a leading `www.` removed. `example.com` blocks `jobs.example.com` but not `notexample.com`.
- The button is a small pill labelled "Save PDF", fixed 8 px from the top, placed by `position`, at the highest z-index, and 60% opaque until hovered.
- It lives in a closed shadow root so page styles can't touch it. A print-media rule on `:host` hides it, which keeps it out of the PDF.
- States: idle, then "Saving..." and disabled, then "Saved" for 2 seconds with the path as tooltip, or "Failed" for 4 seconds with the error as tooltip.
- The content script listens to `chrome.storage.onChanged` and re-asks `get-button-state`, so switches take effect in open tabs without a reload.
- The popup has the master switch, a "Hide on this site" checkbox that adds or removes the current host in the blocklist, and a "Save this page" button that works even where the button is hidden.
- On pages that can't be saved, the popup shows "This page can't be saved" in place of the save button.

## File naming

The saved path is the folder, a slash, and the file name built from the template. With defaults, a page titled "Senior Software Engineer - Acme Careers" saved at 1:06:42 PM on Nov 15, 2026 lands at:

`Downloads/PDFs/20261115-130642.Senior-Software-Engineer-Acme-Careers.pdf`

### Template tokens

| Token | Value | Example |
| --- | --- | --- |
| `{timestamp}` | Local date and time in the `timestampFormat` setting | `20261115-130642` |
| `{title}` | Page title after cleanup | `Senior-Software-Engineer-Acme-Careers` |
| `{domain}` | Host name without a leading `www.` | `acme.com` |
| `{date}` | Local date as `yyyy-MM-dd` | `2026-11-15` |
| `{time}` | Local time as `HHmmss` | `130642` |

Unknown tokens stay as typed. After substitution, remove forbidden characters from the whole name, trim trailing dots and spaces, and append `.pdf` if the name doesn't already end with it in any letter case.

### Timestamp format tokens

| Token | Meaning | Example |
| --- | --- | --- |
| `yyyy` | Four-digit year | `2026` |
| `yy` | Two-digit year | `26` |
| `MM` | Month, two digits | `11` |
| `dd` | Day, two digits | `15` |
| `HH` | Hour, 24-hour, two digits | `13` |
| `mm` | Minute, two digits | `06` |
| `ss` | Second, two digits | `42` |

Match tokens in one pass, longest first, so `yyyy` is never read as two `yy`. Every other character is kept as typed, then forbidden characters are removed.

### Title cleanup

1. Remove characters a file name can't hold: `\ / : * ? " < > |` and control characters.
2. Replace each run of whitespace with one hyphen.
3. Collapse repeated hyphens into one, then trim hyphens, dots and spaces from both ends.
4. Cut to 100 characters, then trim trailing hyphens and dots again.
5. If nothing is left, use the host name without `www.`.

### Folder validation

`validateFolder(input)` returns `{ok: true, value}` or `{ok: false, error}`.

1. Trim the input and turn backslashes into forward slashes.
2. Reject it if it starts with a slash, starts with a drive letter and colon, or has a `..` segment. The error reads "Folder must be inside Downloads."
3. Split on slashes. In each segment, remove forbidden characters and trim spaces and dots from both ends. Drop empty and `.` segments.
4. Join with forward slashes. An empty result is valid and means Downloads itself.

### Test table

All rows use 2026-11-15 13:06:42 local time, the URL `https://www.example.com/jobs/123`, and defaults unless the row says otherwise.

| Function | Input | Expected |
| --- | --- | --- |
| `buildFileName` | Title `Senior Software Engineer - Acme Careers` | `20261115-130642.Senior-Software-Engineer-Acme-Careers.pdf` |
| `buildFileName` | Title is empty | `20261115-130642.example.com.pdf` |
| `buildFileName` | Title `Jobs`, template `{domain}_{date}` | `example.com_2026-11-15.pdf` |
| `buildFileName` | Title `Jobs`, template `{title} {time}.PDF` | `Jobs 130642.PDF` |
| `cleanTitle` | `Q3: Results / "Final"?` | `Q3-Results-Final` |
| `cleanTitle` | `***` | `example.com` |
| `cleanTitle` | 300 letters `a` | 100 letters `a` |
| `cleanTitle` | Leading and trailing spaces and tabs around `Hello   World` | `Hello-World` |
| `formatTimestamp` | Format `yyyy-MM-dd_HH-mm-ss` | `2026-11-15_13-06-42` |
| `formatTimestamp` | Format `HH:mm` | `1306` |
| `formatTimestamp` | Format `yy.MM.dd` | `26.11.15` |
| `validateFolder` | `Work\PDFs\` | ok, `Work/PDFs` |
| `validateFolder` | Empty string | ok, empty string |
| `validateFolder` | `PDFs /2026` | ok, `PDFs/2026` |
| `validateFolder` | `../secret` | rejected |
| `validateFolder` | `C:\Temp` | rejected |
| `validateFolder` | `/home/george` | rejected |
| `isBlocked` | Host `jobs.example.com`, blocklist `example.com` | `true` |
| `isBlocked` | Host `notexample.com`, blocklist `example.com` | `false` |
| `isBlocked` | Host `www.Example.com`, blocklist `example.com` | `true` |

## Build phases

Four phases, each ending in something usable. Automated checks are run by Claude Code. Manual checks are run by George in Chrome after loading the folder at `chrome://extensions` with Developer mode on.

### Phase 1: Capture pipeline

Build `manifest.json`, `background.js`, `offscreen.html` and `offscreen.js`. A click on the toolbar icon saves the active tab as `Downloads/test.pdf`. There is no popup, button or settings yet.

- [ ] Automated: `manifest.json` parses, and every file it names exists.
- [ ] Manual: clicking the icon on a news article saves a readable PDF with no dialog.
- [ ] Manual: a long, image-heavy page saves and opens.
- [ ] Manual: a page behind a login saves as you see it.
- [ ] Manual: note in `NOTES.md` how long the debugger bar stays and whether Chrome's "Ask where to save each file" setting causes a prompt.

### Phase 2: Naming and settings

Build `lib/naming.js`, `lib/settings.js`, both test files and the options page. The pipeline now uses the folder, template, timestamp format and file-exists settings.

- [ ] Automated: `node --test` passes, with one test per row of the test table.
- [ ] Manual: a save lands in `Downloads/PDFs` under the default name pattern.
- [ ] Manual: setting the folder to `Work/PDFs` creates both levels on the next save.
- [ ] Manual: `C:\Temp` and `../x` show the inline error and are not saved.
- [ ] Manual: with the template set to `{title}`, a second save of the same page gets a counter, or replaces the file when set to overwrite.
- [ ] Manual: changing the timestamp format changes the preview and the next saved file.

### Phase 3: Button, popup and blocklist

Build `content.js`, `popup.html` and `popup.js`, and add the `save-pdf` command. The toolbar icon now opens the popup.

- [ ] Manual: after a reload, the button appears on every normal site and saves in one click.
- [ ] Manual: the button is not visible anywhere in the saved PDF.
- [ ] Manual: turning the master switch off removes the button from open tabs without a reload, and on brings it back.
- [ ] Manual: "Hide on this site" removes the button there and on a subdomain, and the host appears in the options blocklist.
- [ ] Manual: "Save this page" in the popup works on a blocked site.
- [ ] Manual: the button shows "Saving..." and then "Saved", with the saved path as its tooltip. On a `chrome://` tab, the popup shows "This page can't be saved".
- [ ] Manual: Alt+Shift+S saves the active tab.

### Phase 4: PDF options and finish

Add the paper, landscape, background and header settings to the options page and pass them to `Page.printToPDF`. Write `README.md`.

- [ ] Automated: `node --test` still passes.
- [ ] Manual: A4 landscape with backgrounds off produces exactly that.
- [ ] Manual: header and footer on shows the URL and date on each page.
- [ ] Manual: following only `README.md`, the extension loads cleanly in a fresh Chrome profile.

Phase 1 carries the only real technical risk, so it comes first and stays small.

## Limitations and risks

None of these block the build. Each has a set handling so Claude Code doesn't need to invent one.

| Risk | What happens | Handling |
| --- | --- | --- |
| Debugger bar | Chrome shows a "started debugging this browser" bar while the extension is attached. | Attach only for the capture and detach in `finally`. Chrome's `--silent-debugger-extension-api` launch switch is reported to hide it. Record what Phase 1 shows. |
| Pages that can't be captured | `chrome://` pages, the Chrome Web Store, other extensions' pages and the built-in PDF viewer reject scripts or the debugger. | No button there. The popup shows "This page can't be saved". |
| Print styling | `Page.printToPDF` uses the site's print stylesheet, which can hide navigation or reflow the layout. | Accept it. |
| Lazy-loaded content | Images below the fold may be blank if they never scrolled into view. | Scroll the page before saving. |
| Very large PDFs | The base64 travels in one runtime message, so a PDF of many tens of megabytes may fail. | Return a clear error. Add chunking only if this happens in real use. |
| Save dialog appears | Chrome's "Ask where to save each file" setting may prompt on every save. | Check in Phase 1. Turn the setting off if it prompts, and say so in `README.md`. |
| Broad permissions | `debugger` plus all-sites access is as powerful as an extension gets. | Acceptable for a private, unpacked extension. Make no network requests and load no remote code. |
| Linux later | Nothing in the build is Windows-only, but nothing is tested on Linux yet. | Rerun the manual checks when you move. |

## Not in this build

Claude Code should not build any of these. They are listed so the boundary is clear.

- **Saving outside Downloads.** This needs a native messaging helper. If it is added later, write it in Node, register it through a registry key on Windows and a manifest file in Chrome's config folder on Linux, and send the PDF in chunks.
- **Auto-scroll before capture** to load lazy images.
- **Rendering with screen styles** in place of the print stylesheet.
- **Margin and scale settings**, and per-site settings.
- **Chrome Web Store publishing** and other browsers.

## Sources

- [chrome.downloads API reference](https://developer.chrome.com/docs/extensions/reference/api/downloads?hl=en): `filename` is relative to Downloads; `conflictAction` values.
- [chrome.debugger API reference](https://developer.chrome.com/docs/extensions/reference/api/debugger?hl=en): available DevTools protocol domains, including Page; the `debugger` permission.
- [chrome.offscreen API reference](https://developer.chrome.com/docs/extensions/reference/api/offscreen?hl=en): the `BLOBS` reason, the `offscreen` permission, creating and closing the document.
- [Native messaging guide](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging?hl=en): only for the helper under Not in this build.
- [DevTools Protocol, Page domain](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-printToPDF): the `Page.printToPDF` parameter list to check names against.

The debugger bar, the `--silent-debugger-extension-api` switch, the `data:` URL size concern, and the `chrome.printing` and `tabs.saveAsPDF` platform limits are from general knowledge, not these pages. Phase 1 confirms the first two.
