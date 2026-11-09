import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const browserDir = path.join(root, "mcp-browser");
const mcpDir = path.join(root, "mcp");
const shimRunner = path.join(browserDir, "run-command.ps1");
const statusDir = process.env.HERDR_INSTALL_STATUS_DIR
  ?? path.join(homedir(), ".config", "herdr-app", ".install-status");

function plans() {
  const register = {
    mcp: { id: "register", cmd: "claude", args: ["mcp", "add", "-s", "user", "natsu-hc", "--", "node", path.join(mcpDir, "server.js")] },
    "agent-desktop": { id: "register", cmd: "claude", args: ["mcp", "add", "-s", "user", "agent-desktop", "--transport", "stdio", "--", "agent-desktop", "mcp"] },
    browser: { id: "register", cmd: "claude", args: ["mcp", "add", "-s", "user", "natsu-browser", "--", "node", path.join(browserDir, "server.js")] },
  };
  return {
    mcp: {
      "mcp-deps": { id: "mcp-deps", cmd: "npm", args: ["install"], cwd: mcpDir },
      register: register.mcp,
    },
    "agent-desktop": {
      "agent-desktop": { id: "agent-desktop", cmd: "npm", args: ["install", "-g", "agent-desktop"] },
      register: register["agent-desktop"],
    },
    browser: {
      "browser-cli": { id: "browser-cli", cmd: "npm", args: ["install", "-g", "agent-browser"] },
      "browser-runtime": { id: "browser-runtime", cmd: "agent-browser", args: ["install"] },
      "browser-deps": { id: "browser-deps", cmd: "npm", args: ["install"], cwd: browserDir },
      register: register.browser,
    },
  };
}

export function buildInstallPlan(section, requested) {
  const available = plans()[section];
  if (!available) throw new Error(`Unknown install section: ${section}`);
  return requested.map((id) => {
    const step = available[id];
    if (!step) throw new Error(`Unknown ${section} install step: ${id}`);
    return step;
  });
}

const WINDOWS_SHIMS = new Set(["npm", "agent-browser", "claude"]);

async function writeStatus(section, status) {
  await mkdir(statusDir, { recursive: true });
  await writeFile(path.join(statusDir, `${section}.json`), JSON.stringify(status));
}

function runStep(step) {
  return new Promise((resolve, reject) => {
    console.log(`\n==> ${step.id}`);
    const windowsShim = process.platform === "win32" && WINDOWS_SHIMS.has(step.cmd);
    const command = windowsShim ? "powershell.exe" : step.cmd;
    const args = windowsShim
      ? ["-NoProfile", "-File", shimRunner, step.cmd, ...step.args]
      : step.args;
    const capture = step.id === "register";
    const child = spawn(command, args, { cwd: step.cwd, stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit", windowsHide: false });
    let output = "";
    child.stdout?.on("data", (chunk) => { output += chunk; process.stdout.write(chunk); });
    child.stderr?.on("data", (chunk) => { output += chunk; process.stderr.write(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || (capture && /already exists/i.test(output))) resolve();
      else reject(new Error(`${step.id} exited with code ${code}`));
    });
  });
}

const args = process.argv.slice(2);
const dryRun = args[0] === "--dry-run";
if (dryRun) args.shift();
const section = args.shift();
const tokenArg = args[0]?.startsWith("--token=") ? args.shift() : null;
const token = tokenArg?.slice("--token=".length) ?? null;

try {
  const plan = buildInstallPlan(section, args);
  if (dryRun) {
    process.stdout.write(JSON.stringify(plan));
  } else {
    for (const step of plan) {
      if (token) await writeStatus(section, { token, state: "running", step: step.id });
      await runStep(step);
    }
    if (token) await writeStatus(section, { token, state: "done" });
    console.log("\nInstall complete. Return to Settings to see Activated.");
  }
} catch (error) {
  const message = String(error?.message ?? error);
  if (token && section) await writeStatus(section, { token, state: "error", error: message });
  console.error(`\nInstall failed: ${message}`);
  process.exitCode = 1;
}
