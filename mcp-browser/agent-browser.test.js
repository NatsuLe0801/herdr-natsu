import test from "node:test";
import assert from "node:assert/strict";
import { runAgentBrowser } from "./agent-browser.js";

test("runAgentBrowser: missing binary resolves to a null-code error instead of throwing", async () => {
  const result = await runAgentBrowser(["get", "title"], { bin: "definitely-not-a-real-binary" });
  assert.deepEqual(result, {
    code: null,
    stdout: "",
    stderr: "definitely-not-a-real-binary not found on PATH",
  });
});
