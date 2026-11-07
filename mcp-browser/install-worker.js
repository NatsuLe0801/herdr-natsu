import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const browserDir = path.join(root, "mcp-browser");
const mcpDir = path.join(root, "mcp");
const shimRunner = path.join(browserDir, "run-command.ps1");

function plans() {
  const register = {
    mcp: { id: "register", cmd: "claude", args: ["mcp", "add", "-s", "user", "natsu-hc", "--", "node", path.join(mcpDir, "server.js")] },
    "computer-use": { id: "register", cmd: "claude", args: ["mcp", "add", "-s", "user", "cua-driver", "--transport", "stdio", "--", "cua-driver", "mcp"] },
    browser: { id: "register", cmd: "claude", args: ["mcp", "add", "-s", "user", "natsu-browser", "--", "node", path.join(browserDir, "server.js")] },
  };
  return {
    mcp: {
      "mcp-deps": { id: "mcp-deps", cmd: "npm", args: ["install"], cwd: mcpDir },
      register: register.mcp,
    },
    "computer-use": {
      "cua-driver": {
        id: "cua-driver",
        cmd: "powershell.exe",
        args: ["-NoProfile", "-Command", "$env:CUA_DRIVER_RS_TELEMETRY_ENABLED='0'; & ([scriptblock]::Create((Invoke-RestMethod 'https://cua.ai/driver/install.ps1'))) -NoAutoStart"],
      },
      register: register["computer-use"],
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

function runStep(step) {
  return new Promise((resolve, reject) => {
    console.log(`\n==> ${step.id}`);
    const windowsShim = process.platform === "win32" && WINDOWS_SHIMS.has(step.cmd);
    const command = windowsShim ? "powershell.exe" : step.cmd;
    const args = windowsShim
      ? ["-NoProfile", "-File", shimRunner, step.cmd, ...step.args]
      : step.args;
    const child = spawn(command, args, { cwd: step.cwd, stdio: "inherit", windowsHide: false });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${step.id} exited with code ${code}`)));
  });
}

const args = process.argv.slice(2);
const dryRun = args[0] === "--dry-run";
if (dryRun) args.shift();
const [section, ...requested] = args;

try {
  const plan = buildInstallPlan(section, requested);
  if (dryRun) {
    process.stdout.write(JSON.stringify(plan));
  } else {
    for (const step of plan) await runStep(step);
    console.log("\nInstall complete. Return to Settings to see Activated.");
  }
} catch (error) {
  console.error(`\nInstall failed: ${error?.message ?? error}`);
  process.exitCode = 1;
}
