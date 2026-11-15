# Save PDF

A Manifest V3 Chrome extension that puts a **Save PDF** button at the top of every site. One click renders
the current tab to PDF and saves it under a folder inside Downloads, with no print dialog.

Plain JavaScript, no dependencies, no build step.

## Install (load unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this `save-pdf-extension` folder.
4. Reload any tabs that were already open, so the button appears on them.
5. Optional: pin the extension from the puzzle-piece menu to reach the popup quickly.

If Chrome's **Settings → Downloads → Ask where to save each file before downloading** is on, Chrome may show
a save dialog on every PDF. Turn it off for one-click saving.

## Use

- **Button**: click "Save PDF" at the top of the page. It shows "Saving...", then "Saved" (hover for the path)
  or "Failed" (hover for the reason). The button is never printed into the PDF.
- **Popup** (toolbar icon): master on/off switch, "Hide on this site", and "Save this page", which works even
  where the button is hidden.
- **Keyboard**: Alt+Shift+S saves the active tab. Change it at `chrome://extensions/shortcuts`.
- **Options** (popup → Options): folder, file name template, timestamp format, what to do when the file exists,
  button position, blocked sites, paper size, landscape, backgrounds, header and footer.

Files land at `Downloads/<folder>/<name>.pdf`. With defaults that is, for example,
`Downloads/PDFs/20261115-130642.Senior-Software-Engineer-Acme-Careers.pdf`.

While a page is being captured, Chrome shows a "started debugging this browser" bar. That is the
`chrome.debugger` API at work; the extension detaches as soon as the PDF is generated.

Chrome pages (`chrome://`), the Chrome Web Store, other extensions' pages and the built-in PDF viewer can't
be captured. The popup says "This page can't be saved" there.

## Tests

```sh
npm test   # runs node --test; Node 20+ needed, no install step
```

## Privacy

The extension makes no network requests and loads no remote code. It needs the `debugger` permission and
access to all sites to render pages; that is as powerful as an extension gets, so only load it from a copy
you trust.
