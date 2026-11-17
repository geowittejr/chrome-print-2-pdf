import { test } from "node:test";
import assert from "node:assert/strict";
import { buildExpandExpression, isExpandLabel, isNavigatingHref } from "../src/lib/expand.js";

test("isExpandLabel: captions that reveal more text", () => {
  for (const label of [
    "…see more",
    "...more",
    "See more",
    "Show more",
    "  Read   more ",
    "Read more about this role",
    "Show full description",
    "View the rest",
    "Expand",
    "Expand all",
    "(more)",
    "Continue reading",
  ]) {
    assert.equal(isExpandLabel(label), true, label);
  }
});

test("isExpandLabel: captions that load, navigate, open menus or collapse", () => {
  for (const label of [
    "Load more",
    "See more jobs",
    "Show more results",
    "View more comments",
    "See more replies",
    "Show less",
    "See less",
    "More actions",
    "Hide",
    "Collapse",
    "Show",
    "Learn more", // usually a link to another page
    "Next page",
    "",
    "Read more " + "x".repeat(80),
  ]) {
    assert.equal(isExpandLabel(label), false, label);
  }
});

test("isNavigatingHref: script hooks stay on the page", () => {
  assert.equal(isNavigatingHref(""), false);
  assert.equal(isNavigatingHref("#"), false);
  assert.equal(isNavigatingHref("javascript:void(0)"), false);
  assert.equal(isNavigatingHref("/jobs/123"), true);
  assert.equal(isNavigatingHref("https://example.com"), true);
  assert.equal(isNavigatingHref("#section-2"), true);
});

test("buildExpandExpression: produces one self-contained, parseable call", () => {
  const expr = buildExpandExpression();
  assert.doesNotThrow(() => new Function(`return ${expr};`));
  assert.match(expr, /^\(async function expandHiddenContent\(/);
});
