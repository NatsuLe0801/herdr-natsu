import { execFile, spawn } from "node:child_process";

export function runHc(args, { stdin, bin = "hc" } = {}) {
  return new Promise((resolve) => {
    const child = execFile(bin, ["--json", ...args], { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && err.code === "ENOENT") {
        resolve({ code: null, stdout: "", stderr: `${bin} not found on PATH` });
        return;
      }
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr });
    });
    if (stdin != null) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
  });
}

export function runHcTimed(args, waitMs, { bin = "hc" } = {}) {
  return new Promise((resolve) => {
    let out = "", err = "";
    const child = spawn(bin, ["--json", ...args]);
    child.on("error", (e) => {
      resolve({ lines: [], error: e.code === "ENOENT" ? `${bin} not found on PATH` : e.message });
    });
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (err += d));
    const timer = setTimeout(() => child.kill(), waitMs);
    child.on("close", () => {
      clearTimeout(timer);
      resolve({ lines: out.split("\n").filter(Boolean), stderr: err });
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
