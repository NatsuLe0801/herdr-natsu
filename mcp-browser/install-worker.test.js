import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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

test("Windows shim runner preserves a bare double dash", async () => {
  if (process.platform !== "win32") return;
  const dir = await mkdtemp(path.join(tmpdir(), "natsu-shim-"));
  const capture = path.join(dir, "capture.js");
  await writeFile(capture, "process.stdout.write(JSON.stringify(process.argv.slice(2)))");
  try {
    const result = await new Promise((resolve) => {
      const child = spawn("powershell.exe", ["-NoProfile", "-File", shimRunner, "node", capture, "mcp", "add", "-s", "user", "x", "--", "node", "server.js"], { windowsHide: true });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), ["mcp", "add", "-s", "user", "x", "--", "node", "server.js"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("install worker boots before local dependencies exist", async () => {
  const source = await readFile(worker, "utf8");
  assert.doesNotMatch(source, /from ["']cross-spawn["']/);
});

test("install worker writes an immediate error status", async () => {
  const statusDir = await mkdtemp(path.join(tmpdir(), "natsu-install-status-"));
  try {
    const result = await new Promise((resolve) => {
      const child = spawn(process.execPath, [worker, "browser", "--token=test-run", "not-a-step"], {
        windowsHide: true,
        env: { ...process.env, HERDR_INSTALL_STATUS_DIR: statusDir },
      });
      child.on("close", (code) => resolve({ code }));
    });
    assert.equal(result.code, 1);
    const status = JSON.parse(await readFile(path.join(statusDir, "browser.json"), "utf8"));
    assert.equal(status.token, "test-run");
    assert.equal(status.state, "error");
    assert.match(status.error, /Unknown browser install step/);
  } finally {
    await rm(statusDir, { recursive: true, force: true });
  }
});

test("existing MCP registration is treated as success", async () => {
  if (process.platform !== "win32") return;
  const dir = await mkdtemp(path.join(tmpdir(), "natsu-existing-mcp-"));
  const statusDir = path.join(dir, "status");
  await writeFile(path.join(dir, "claude.cmd"), "@echo MCP server natsu-browser already exists in user config 1>&2\r\n@exit /b 1\r\n");
  try {
    const result = await new Promise((resolve) => {
      const child = spawn(process.execPath, [worker, "browser", "--token=existing", "register"], {
        windowsHide: true,
        env: { ...process.env, PATH: `${dir};${process.env.PATH}`, HERDR_INSTALL_STATUS_DIR: statusDir },
      });
      child.on("close", (code) => resolve({ code }));
    });
    assert.equal(result.code, 0);
    const status = JSON.parse(await readFile(path.join(statusDir, "browser.json"), "utf8"));
    assert.equal(status.state, "done");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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

test("agent-desktop worker installs agent-desktop from npm, then registers it", async () => {
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, [worker, "--dry-run", "agent-desktop", "agent-desktop", "register"], { windowsHide: true });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.on("close", (code) => resolve({ code, stdout }));
  });

  assert.equal(result.code, 0);
  const plan = JSON.parse(result.stdout);
  assert.deepEqual(plan[0].args, ["install", "-g", "agent-desktop"]);
  assert.deepEqual(plan[1].args, ["mcp", "add", "-s", "user", "agent-desktop", "--transport", "stdio", "--", "agent-desktop", "mcp"]);
});
