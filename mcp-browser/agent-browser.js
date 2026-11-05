import { execFile } from "node:child_process";

const AGENT_BROWSER_BIN = process.platform === "win32" ? "agent-browser.cmd" : "agent-browser";

export function runAgentBrowser(args, { bin = AGENT_BROWSER_BIN } = {}) {
  return new Promise((resolve) => {
    const onDone = (err, stdout, stderr) => {
      if (err && err.code === "ENOENT") {
        resolve({ code: null, stdout: "", stderr: `${bin} not found on PATH` });
        return;
      }
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr });
    };
    try {
      execFile(bin, [...args, "--json"], { maxBuffer: 16 * 1024 * 1024 }, onDone);
    } catch {
      // Node refuses to exec .cmd/.bat files directly without a shell (throws
      // EINVAL synchronously, before spawning anything) — retry through the shell.
      execFile(bin, [...args, "--json"], { maxBuffer: 16 * 1024 * 1024, shell: true }, onDone);
    }
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
