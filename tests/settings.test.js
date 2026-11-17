import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, bottomMarginInches, expandSeconds, isBlocked } from "../src/lib/settings.js";

test("isBlocked: subdomain of a blocked host", () => {
  assert.equal(isBlocked("jobs.example.com", ["example.com"]), true);
});

test("isBlocked: different host sharing a suffix", () => {
  assert.equal(isBlocked("notexample.com", ["example.com"]), false);
});

test("isBlocked: www. and case ignored", () => {
  assert.equal(isBlocked("www.Example.com", ["example.com"]), true);
});

test("bottomMarginInches and expandSeconds: clamp, and fall back to defaults", () => {
  assert.equal(bottomMarginInches("1.5"), 1.5);
  assert.equal(bottomMarginInches(-2), 0);
  assert.equal(bottomMarginInches(""), DEFAULTS.bottomMargin);
  assert.equal(bottomMarginInches(undefined), DEFAULTS.bottomMargin);
  assert.equal(expandSeconds(90), 60);
  assert.equal(expandSeconds("abc"), DEFAULTS.expandTimeout);
  assert.equal(expandSeconds(0), 0);
});
