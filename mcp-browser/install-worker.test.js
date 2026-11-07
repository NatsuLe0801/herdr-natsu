import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const worker = fileURLToPath(new URL("./install-worker.js", import.meta.url));
const shimRunner = fileURLToPath(new URL("./run-command.ps1", import.meta.url));

test("Windows shim runner forwards argv without command-string parsing", async () => {
  if (process.platform !== "win32") return;
  const result = await new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-File", shimRunner, "npm", "--version"], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test("install worker boots before local dependencies exist", async () => {
  const source = await readFile(worker, "utf8");
  assert.doesNotMatch(source, /from ["']cross-spawn["']/);
});

test("browser install worker plans CLI, runtime, dependencies, then registration", async () => {
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, [worker, "--dry-run", "browser", "browser-cli", "browser-runtime", "browser-deps", "register"], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });

  assert.equal(result.code, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.deepEqual(plan.map((step) => step.id), ["browser-cli", "browser-runtime", "browser-deps", "register"]);
  assert.deepEqual(plan[0].args, ["install", "-g", "agent-browser"]);
  assert.deepEqual(plan[1].args, ["install"]);
  assert.equal(plan[2].cwd.endsWith("mcp-browser"), true);
  assert.deepEqual(plan[3].args.slice(0, 6), ["mcp", "add", "-s", "user", "natsu-browser", "--"]);
});

test("computer-use worker uses the privacy-preserving official installer", async () => {
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, [worker, "--dry-run", "computer-use", "cua-driver", "register"], { windowsHide: true });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("close", (code) => resolve({ code, stdout }));
  });

  assert.equal(result.code, 0);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan[0].args.at(-1).includes("CUA_DRIVER_RS_TELEMETRY_ENABLED='0'"), true);
  assert.equal(plan[0].args.at(-1).includes("-NoAutoStart"), true);
  assert.deepEqual(plan[1].args, ["mcp", "add", "-s", "user", "cua-driver", "--transport", "stdio", "--", "cua-driver", "mcp"]);
});
