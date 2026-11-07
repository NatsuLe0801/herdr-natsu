import { runAgentBrowser } from "./agent-browser.js";

const result = await runAgentBrowser(process.argv.slice(2));
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exitCode = result.code ?? 1;
