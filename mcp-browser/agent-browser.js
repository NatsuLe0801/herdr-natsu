import spawn from "cross-spawn";

export function runAgentBrowser(args, { bin = "agent-browser" } = {}) {
  return new Promise((resolve) => {
    let stdout = "", stderr = "";
    const child = spawn(bin, [...args, "--json"]);
    child.on("error", (err) => {
      resolve({ code: null, stdout: "", stderr: err.code === "ENOENT" ? `${bin} not found on PATH` : err.message });
    });
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
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
