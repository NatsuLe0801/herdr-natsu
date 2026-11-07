import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { runAgentBrowser } from "./agent-browser.js";
import * as agentBrowser from "./agent-browser.js";

test("runAgentBrowser: missing binary resolves to a null-code error instead of throwing", async () => {
  const result = await runAgentBrowser(["get", "title"], { bin: "definitely-not-a-real-binary" });
  assert.deepEqual(result, {
    code: null,
    stdout: "",
    stderr: "definitely-not-a-real-binary not found on PATH",
  });
});

test("defaultAgentBrowserBin bypasses the npm cmd shim on Windows", () => {
  assert.equal(typeof agentBrowser.defaultAgentBrowserBin, "function");
  const bin = agentBrowser.defaultAgentBrowserBin({
    platform: "win32",
    execPath: "C:/node/node.exe",
    exists: (path) => path === "C:\\node\\node_modules\\agent-browser\\bin\\agent-browser-win32-x64.exe",
  });
  assert.equal(bin, "C:\\node\\node_modules\\agent-browser\\bin\\agent-browser-win32-x64.exe");
});

test("runAgentBrowser resolves when the CLI exits even if inherited pipes stay open", async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const spawn = () => child;
  const resultPromise = runAgentBrowser(["open", "example.com"], { bin: "fake-agent-browser", spawn });

  child.stdout.write('{"success":true}\n');
  child.emit("exit", 0);

  assert.deepEqual(await resultPromise, { code: 0, stdout: '{"success":true}\n', stderr: "" });
});

test("runAgentBrowser drains stdout chunks that arrive just after exit", async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const resultPromise = runAgentBrowser(["snapshot"], { bin: "fake-agent-browser", spawn: () => child });

  child.stdout.write('{"success":');
  child.emit("exit", 0);
  setTimeout(() => child.stdout.write("true}\n"), 5);

  assert.deepEqual(await resultPromise, { code: 0, stdout: '{"success":true}\n', stderr: "" });
});
