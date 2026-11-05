import test from "node:test";
import assert from "node:assert/strict";
import { runHc, runHcTimed, toToolContent } from "./hc.js";

test("toToolContent: success with JSON stdout", () => {
  const r = toToolContent({ code: 0, stdout: '{"a":1}\n', stderr: "" });
  assert.equal(r.isError, undefined);
  assert.deepEqual(JSON.parse(r.content[0].text), { a: 1 });
});

test("toToolContent: success with non-JSON stdout returns raw text", () => {
  const r = toToolContent({ code: 0, stdout: "plain text\n", stderr: "" });
  assert.equal(r.isError, undefined);
  assert.equal(r.content[0].text, "plain text\n");
});

test("toToolContent: nonzero exit is an error, never thrown", () => {
  const r = toToolContent({ code: 2, stdout: "", stderr: "boom" });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /boom/);
});

test("toToolContent: code null (binary not found) is an error", () => {
  const r = toToolContent({ code: null, stdout: "", stderr: "hc not found on PATH" });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /not found on PATH/);
});

test("runHc: missing binary resolves with code null, never rejects", async () => {
  const r = await runHc(["ls"], { bin: "definitely-not-a-real-binary-xyz" });
  assert.equal(r.code, null);
  assert.match(r.stderr, /not found on PATH/);
});

test("runHc: real hc ls --json succeeds (requires hc on PATH)", async () => {
  const r = await runHc(["ls"]);
  assert.equal(r.code, 0);
  assert.doesNotThrow(() => JSON.parse(r.stdout));
});

test("runHcTimed: missing binary resolves with empty lines and an error, never rejects", async () => {
  const r = await runHcTimed(["events"], 200, { bin: "definitely-not-a-real-binary-xyz" });
  assert.deepEqual(r.lines, []);
  assert.match(r.error, /not found on PATH/);
});

test("runHc: forced --json never lands after a trailing variadic argv (hc exec echo)", async () => {
  const r = await runHc(["exec", "echo", "sentinel-value"]);
  assert.equal(r.code, 0);
  const parsed = JSON.parse(r.stdout);
  const decoded = Buffer.from(parsed.stdout, "base64").toString().trim();
  assert.equal(decoded, "sentinel-value");
});

test("runHcTimed: real hc events stops within the wait window on a quiet system", async () => {
  const started = Date.now();
  const r = await runHcTimed(["events"], 300);
  assert.ok(Array.isArray(r.lines));
  assert.ok(Date.now() - started < 3000);
});
