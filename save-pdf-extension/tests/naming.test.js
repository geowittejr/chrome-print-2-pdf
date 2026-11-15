import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFileName, cleanTitle, formatTimestamp, validateFolder } from "../lib/naming.js";
import { DEFAULTS } from "../lib/settings.js";

// 2026-11-15 13:06:42 local time.
const DATE = new Date(2026, 10, 15, 13, 6, 42);
const URL_ = "https://www.example.com/jobs/123";
const HOST = "example.com";

const build = (overrides) =>
  buildFileName({
    title: "",
    url: URL_,
    date: DATE,
    template: DEFAULTS.template,
    timestampFormat: DEFAULTS.timestampFormat,
    ...overrides,
  });

test("buildFileName: default template with a normal title", () => {
  assert.equal(
    build({ title: "Senior Software Engineer - Acme Careers" }),
    "20261115-130642.Senior-Software-Engineer-Acme-Careers.pdf",
  );
});

test("buildFileName: empty title falls back to the host", () => {
  assert.equal(build({ title: "" }), "20261115-130642.example.com.pdf");
});

test("buildFileName: {domain}_{date} template", () => {
  assert.equal(build({ title: "Jobs", template: "{domain}_{date}" }), "example.com_2026-11-15.pdf");
});

test("buildFileName: template already ending in .PDF keeps it", () => {
  assert.equal(build({ title: "Jobs", template: "{title} {time}.PDF" }), "Jobs 130642.PDF");
});

test("cleanTitle: forbidden characters removed", () => {
  assert.equal(cleanTitle('Q3: Results / "Final"?', HOST), "Q3-Results-Final");
});

test("cleanTitle: nothing left falls back to the host", () => {
  assert.equal(cleanTitle("***", HOST), "example.com");
});

test("cleanTitle: cut to 100 characters", () => {
  assert.equal(cleanTitle("a".repeat(300), HOST), "a".repeat(100));
});

test("cleanTitle: surrounding whitespace trimmed, inner runs become one hyphen", () => {
  assert.equal(cleanTitle(" \t  Hello   World \t ", HOST), "Hello-World");
});

test("formatTimestamp: yyyy-MM-dd_HH-mm-ss", () => {
  assert.equal(formatTimestamp(DATE, "yyyy-MM-dd_HH-mm-ss"), "2026-11-15_13-06-42");
});

test("formatTimestamp: forbidden colon removed", () => {
  assert.equal(formatTimestamp(DATE, "HH:mm"), "1306");
});

test("formatTimestamp: two-digit year", () => {
  assert.equal(formatTimestamp(DATE, "yy.MM.dd"), "26.11.15");
});

test("validateFolder: backslashes and trailing slash", () => {
  assert.deepEqual(validateFolder("Work\\PDFs\\"), { ok: true, value: "Work/PDFs" });
});

test("validateFolder: empty string means Downloads itself", () => {
  assert.deepEqual(validateFolder(""), { ok: true, value: "" });
});

test("validateFolder: segment spaces trimmed", () => {
  assert.deepEqual(validateFolder("PDFs /2026"), { ok: true, value: "PDFs/2026" });
});

test("validateFolder: rejects ..", () => {
  assert.equal(validateFolder("../secret").ok, false);
});

test("validateFolder: rejects drive letter", () => {
  assert.equal(validateFolder("C:\\Temp").ok, false);
});

test("validateFolder: rejects absolute path", () => {
  const result = validateFolder("/home/george");
  assert.equal(result.ok, false);
  assert.equal(result.error, "Folder must be inside Downloads.");
});
