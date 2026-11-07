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
