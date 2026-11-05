import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { runAgentBrowser, toToolContent } from "./agent-browser.js";
import { buildArgv } from "./build-argv.js";
import { TOOLS } from "./tools.js";

export function createServer() {
  const server = new McpServer({ name: "natsu-browser", version: "0.1.0" });

  for (const def of TOOLS) {
    if (def.special) continue;
    server.tool(def.name, def.description, def.schema, async (input) => {
      return toToolContent(await runAgentBrowser(buildArgv(def, input)));
    });
  }

  const getDef = TOOLS.find((t) => t.name === "browser_get");
  server.tool(getDef.name, getDef.description, getDef.schema, async (input) => {
    const argv = ["get", input.subcommand, ...(input.selector ? [input.selector] : []), ...(input.attr_name ? [input.attr_name] : [])];
    if (input.session) argv.push("--session", input.session);
    return toToolContent(await runAgentBrowser(argv));
  });

  const execDef = TOOLS.find((t) => t.name === "agent_browser_exec");
  server.tool(execDef.name, execDef.description, execDef.schema, async (input) => {
    return toToolContent(await runAgentBrowser(input.args));
  });

  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
