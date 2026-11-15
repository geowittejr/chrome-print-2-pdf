import { test } from "node:test";
import assert from "node:assert/strict";
import { isBlocked } from "../src/lib/settings.js";

test("isBlocked: subdomain of a blocked host", () => {
  assert.equal(isBlocked("jobs.example.com", ["example.com"]), true);
});

test("isBlocked: different host sharing a suffix", () => {
  assert.equal(isBlocked("notexample.com", ["example.com"]), false);
});

test("isBlocked: www. and case ignored", () => {
  assert.equal(isBlocked("www.Example.com", ["example.com"]), true);
});
