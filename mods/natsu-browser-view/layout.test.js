import test from "node:test";
import assert from "node:assert/strict";
import * as layout from "./session.js";

test("fitImage fills the preview width while preserving aspect ratio", () => {
  assert.equal(typeof layout.fitImage, "function");
  assert.deepEqual(layout.fitImage(700, 1000, 1258, 566), { w: 668, h: 300 });
});

test("fitImage uses preview height when it is the tighter bound", () => {
  assert.deepEqual(layout.fitImage(900, 300, 1258, 566), { w: 595, h: 268 });
});

test("fitImage returns no size before layout or image dimensions exist", () => {
  assert.deepEqual(layout.fitImage(0, 1000, 1258, 566), { w: 0, h: 0 });
  assert.deepEqual(layout.fitImage(700, 1000, 0, 0), { w: 0, h: 0 });
});

test("browserViewport is a fixed 1080p desktop resolution", () => {
  assert.equal(typeof layout.browserViewport, "function");
  assert.deepEqual(layout.browserViewport(700, 1000), { w: 1920, h: 1080 });
  assert.deepEqual(layout.browserViewport(0, 1000), { w: 1920, h: 1080 });
});

test("sameImage detects whether a staged screenshot changed", () => {
  assert.equal(typeof layout.sameImage, "function");
  assert.equal(layout.sameImage(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), true);
  assert.equal(layout.sameImage(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])), false);
  assert.equal(layout.sameImage(null, new Uint8Array([1])), false);
});

test("nextShotIndex always writes to the hidden buffer", () => {
  assert.equal(typeof layout.nextShotIndex, "function");
  assert.equal(layout.nextShotIndex(null), 0);
  assert.equal(layout.nextShotIndex(0), 1);
  assert.equal(layout.nextShotIndex(1), 0);
});
