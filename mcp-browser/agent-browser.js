import { existsSync } from "node:fs";
import path from "node:path";
import crossSpawn from "cross-spawn";

export function defaultAgentBrowserBin({ platform = process.platform, execPath = process.execPath, exists = existsSync } = {}) {
  if (platform === "win32") {
    const candidate = path.win32.join(path.win32.dirname(execPath), "node_modules", "agent-browser", "bin", "agent-browser-win32-x64.exe");
    if (exists(candidate)) return candidate;
  }
  return "agent-browser";
}

export function runAgentBrowser(args, { bin = defaultAgentBrowserBin(), spawn = crossSpawn } = {}) {
  return new Promise((resolve) => {
    let stdout = "", stderr = "", settled = false, exited = false, exitCode = null, drainTimer = null;
    const done = (result) => {
      if (settled) return;
      settled = true;
      if (drainTimer) clearTimeout(drainTimer);
      resolve(result);
    };
    const drain = () => {
      if (!exited) return;
      if (drainTimer) clearTimeout(drainTimer);
      drainTimer = setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        done({ code: exitCode, stdout, stderr });
      }, 100);
    };
    const child = spawn(bin, [...args, "--json"]);
    child.on("error", (err) => {
      done({ code: null, stdout: "", stderr: err.code === "ENOENT" ? `${bin} not found on PATH` : err.message });
    });
    child.stdout?.on("data", (d) => { stdout += d; drain(); });
    child.stderr?.on("data", (d) => { stderr += d; drain(); });
    child.on("exit", (code) => {
      exited = true;
      exitCode = code;
      drain();
    });
  });
}

export function toToolContent(result) {
  if (result.code === null || result.code !== 0) {
    const text = result.code === null
      ? result.stderr
      : JSON.stringify({ error: true, code: result.code, stdout: result.stdout, stderr: result.stderr });
    return { content: [{ type: "text", text }], isError: true };
  }
  let data;
  try {
    data = JSON.parse(result.stdout);
  } catch {
    data = result.stdout;
  }
  return { content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data) }] };
}
