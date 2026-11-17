// Page sizing for "continuous" PDFs: the whole page on one tall PDF page, so there are no page breaks
// and no gaps where content was pushed to the next page. Pure functions; the worker does the measuring.

/** CSS pixels per inch. */
export const PX_PER_INCH = 96;

/** Margin on every side of the PDF page, in inches (Chrome's default print margin). */
export const MARGIN_IN = 0.4;

/** Extra height so rounding never spills a sliver onto a second page, in inches. */
export const SLACK_IN = 0.25;

/** Width and height in inches of the chosen paper, swapped for landscape. */
export function paperDimensions(paper, landscape) {
  return landscape ? { width: paper.height, height: paper.width } : { width: paper.width, height: paper.height };
}

/** CSS pixels left on a page side `sizeIn` inches long once both margins are taken off. */
export function printablePx(sizeIn) {
  return Math.max(1, Math.round((sizeIn - 2 * MARGIN_IN) * PX_PER_INCH));
}

/**
 * Paper size in inches for one page that holds content of the measured CSS pixel size.
 * The width is never narrower than `minWidthIn`, so wide content gets a wider page instead of
 * being shrunk to fit; the height fits the content.
 */
export function continuousPaper({ minWidthIn, contentWidthPx, contentHeightPx }) {
  const width = Math.max(minWidthIn, contentWidthPx / PX_PER_INCH + 2 * MARGIN_IN);
  const height = Math.max(1, contentHeightPx / PX_PER_INCH + 2 * MARGIN_IN + SLACK_IN);
  return { paperWidth: round2(width), paperHeight: round2(height) };
}

/**
 * Number of pages in a PDF given as a binary string (the result of atob). Counts page objects,
 * which Chrome writes uncompressed. Returns 0 when none are found.
 */
export function countPdfPages(binary) {
  const matches = String(binary).match(/\/Type\s*\/Page(?![a-zA-Z])/g);
  return matches ? matches.length : 0;
}

function round2(n) {
  return Math.ceil(n * 100) / 100;
}
