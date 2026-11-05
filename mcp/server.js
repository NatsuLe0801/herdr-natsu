import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { runHc, runHcTimed, toToolContent } from "./hc.js";
import { buildArgv } from "./build-argv.js";
import { TOOLS } from "./tools.js";

export function createServer() {
  const server = new McpServer({ name: "natsu-hc", version: "0.1.0" });

  for (const def of TOOLS) {
    if (def.special) continue;
    server.tool(def.name, def.description, def.schema, async (input) => {
      if (def.validate) {
        const err = def.validate(input);
        if (err) return { content: [{ type: "text", text: err }], isError: true };
      }
      return toToolContent(await runHc(buildArgv(def, input)));
    });
  }

  const execDef = TOOLS.find((t) => t.name === "hc_exec");
  server.tool(execDef.name, execDef.description, execDef.schema, async (input) => {
    const flags = buildArgv({ cmd: execDef.cmd, args: execDef.args }, input);
    const argv = [...flags, ...(input.stdin != null ? ["--stdin"] : []), ...(input.argv ?? [])];
    return toToolContent(await runHc(argv, { stdin: input.stdin }));
  });

  const writeDef = TOOLS.find((t) => t.name === "hc_file_write");
  server.tool(writeDef.name, writeDef.description, writeDef.schema, async (input) => {
    return toToolContent(await runHc(buildArgv(writeDef, input), { stdin: input.content }));
  });

  const eventsDef = TOOLS.find((t) => t.name === "hc_events");
  server.tool(eventsDef.name, eventsDef.description, eventsDef.schema, async (input) => {
    const { lines, error } = await runHcTimed(buildArgv(eventsDef, input), input.wait_ms ?? 2000);
    if (error) return { content: [{ type: "text", text: error }], isError: true };
    const events = lines.map((l) => {
      try { return JSON.parse(l); } catch { return l; }
    });
    return { content: [{ type: "text", text: JSON.stringify(events) }] };
  });

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
