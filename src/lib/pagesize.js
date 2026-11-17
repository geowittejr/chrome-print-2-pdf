// Page sizing for "continuous" PDFs: the whole page on one tall PDF page, so there are no page breaks
// and no gaps where content was pushed to the next page. Pure functions; the worker does the measuring.

/** CSS pixels per inch. */
export const PX_PER_INCH = 96;

/** Margin on every side of the PDF page, in inches (Chrome's default print margin). */
export const MARGIN_IN = 0.4;

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
 * being shrunk to fit; the height fits the content, plus `bottomMarginIn` of extra space at the bottom
 * (the "Bottom margin" option, raised when print layout runs taller than the measurement).
 */
export function continuousPaper({ minWidthIn, contentWidthPx, contentHeightPx, bottomMarginIn = 0 }) {
  const width = Math.max(minWidthIn, contentWidthPx / PX_PER_INCH + 2 * MARGIN_IN);
  const height = Math.max(1, contentHeightPx / PX_PER_INCH + 2 * MARGIN_IN + Math.max(0, bottomMarginIn));
  return { paperWidth: round2(width), paperHeight: round2(height) };
}

function round2(n) {
  return Math.ceil(n * 100) / 100;
}
