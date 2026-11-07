import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("./run-cli.js", import.meta.url));

test("run-cli forwards argv to agent-browser without a command shell", async () => {
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, [runner, "--version"], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /agent-browser/);
});
