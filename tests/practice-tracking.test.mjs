import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createPracticeTracker } from "../src/practiceTracking.js";

test("creating a tracker emits nothing until an explicit action", () => {
  const events = [];
  createPracticeTracker((...args) => events.push(args));
  assert.equal(events.length, 0);
});

test("wrong then correct answers start and complete once across repeated actions", () => {
  const events = [];
  const report = createPracticeTracker((...args) => events.push(args));
  report("candle", false); report("candle", false);
  assert.deepEqual(events.map(e => e[0]), ["practice_start"]);
  report("candle", true); report("candle", true); report("candle", false);
  assert.deepEqual(events.map(e => e[0]), ["practice_start", "practice_complete"]);
});

test("correct first answer starts before completing; each exercise is independent", () => {
  const events = [];
  const report = createPracticeTracker((...args) => events.push(args));
  for (const id of ["candle", "cost", "challenge"]) report(id, true);
  assert.equal(events.length, 6);
  for (let i = 0; i < 6; i += 2) {
    assert.equal(events[i][0], "practice_start");
    assert.equal(events[i + 1][0], "practice_complete");
    assert.equal(events[i][1].practice_id, events[i + 1][1].practice_id);
  }
});

test("range/reveal interactions do not complete a challenge", () => {
  const events = [];
  const report = createPracticeTracker((...args) => events.push(args));
  report("challenge"); report("challenge");
  assert.deepEqual(events.map(e => e[0]), ["practice_start"]);
  report("challenge", true);
  assert.equal(events[1][0], "practice_complete");
});

test("invalid identifiers and non-boolean answers cannot fabricate completions", () => {
  const events = [];
  const report = createPracticeTracker((...args) => events.push(args));
  report("note with private content", true); report(null, true); report({}, true);
  assert.equal(events.length, 0);
  report("cost", "yes");
  assert.deepEqual(events.map(e => e[0]), ["practice_start"]);
});

test("payloads contain only fixed anonymous exercise metadata", () => {
  const events = [];
  const report = createPracticeTracker((...args) => events.push(args));
  report("candle", true, { email: "do-not-send", note: "do-not-send" });
  assert.deepEqual(events[0][1], { practice_id: "candle", placement: "demo", data_source: "illustrative_sample", sample_mode: true, event_schema_version: 1 });
});

test("tag failure never interrupts learning or causes retry storms", () => {
  let attempts = 0;
  const report = createPracticeTracker(() => { attempts++; throw Error("tag unavailable"); });
  assert.doesNotThrow(() => { report("cost", true); report("cost", true); });
  assert.equal(attempts, 2);
});

test("a fresh page tracker resets in-memory deduplication", () => {
  const events = [];
  const send = (...args) => events.push(args);
  const first = createPracticeTracker(send);
  const remountedConsumer = first;
  first("candle", true); remountedConsumer("candle", true);
  assert.equal(events.length, 2);
  createPracticeTracker(send)("candle", true);
  assert.equal(events.length, 4);
});

const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
test("practice metadata reaches only production GA4; purchases stay rejected", () => {
  const events = [];
  const ctx = { window: { location: { hostname: "halyoapp.com" }, gtag: (...args) => events.push(args) }, OFFER_PRICE_USD: 39 };
  const fn = vm.runInNewContext(app.slice(app.indexOf("function trackGoogle("), app.indexOf("function track(event")) + ";trackGoogle", ctx);
  for (const hostname of ["halyoapp.com", "www.halyoapp.com"]) {
    ctx.window.location.hostname = hostname;
    createPracticeTracker(fn)("challenge", true);
  }
  assert.equal(events.length, 4);
  assert.ok(events.every(e => e[2].send_to === "G-85ZCNXLSDS"));
  for (const hostname of ["localhost", "deploy-preview.example"]) {
    ctx.window.location.hostname = hostname;
    createPracticeTracker(fn)("challenge", true);
  }
  assert.equal(events.length, 4);
  ctx.window.location.hostname = "halyoapp.com";
  fn("purchase", { value: 39 });
  assert.equal(events.length, 4);
});
