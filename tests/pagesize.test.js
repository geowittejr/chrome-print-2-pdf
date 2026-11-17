import { test } from "node:test";
import assert from "node:assert/strict";
import { MARGIN_IN, continuousPaper, paperDimensions, printablePx } from "../src/lib/pagesize.js";

test("paperDimensions: landscape swaps width and height", () => {
  assert.deepEqual(paperDimensions({ width: 8.5, height: 11 }, true), { width: 11, height: 8.5 });
  assert.deepEqual(paperDimensions({ width: 8.5, height: 11 }, false), { width: 8.5, height: 11 });
});

test("printablePx: letter width minus margins", () => {
  assert.equal(printablePx(8.5), Math.round((8.5 - 2 * MARGIN_IN) * 96));
});

test("continuousPaper: height fits the content plus margins and the bottom margin setting", () => {
  const { paperWidth, paperHeight } = continuousPaper({
    minWidthIn: 8.5,
    contentWidthPx: 739,
    contentHeightPx: 9600,
    bottomMarginIn: 0.5,
  });
  assert.equal(paperWidth, 8.5);
  assert.ok(Math.abs(paperHeight - (100 + 2 * MARGIN_IN + 0.5)) < 0.011);
});

test("continuousPaper: wide content widens the page instead of shrinking", () => {
  const { paperWidth } = continuousPaper({ minWidthIn: 8.5, contentWidthPx: 1200, contentHeightPx: 960 });
  assert.ok(paperWidth >= 1200 / 96 + 2 * MARGIN_IN);
});
