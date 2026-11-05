import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "./server.js";

async function connected() {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.1.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

test("registers all 25 tools, including the 3 special-cased ones", async () => {
  const client = await connected();
  const { tools } = await client.listTools();
  assert.equal(tools.length, 25);
  for (const n of ["hc_run", "hc_exec", "hc_file_write", "hc_events"]) {
    assert.ok(tools.some((t) => t.name === n), n);
  }
  await client.close();
});

test("hc_templates calls real hc and returns without error", async () => {
  const client = await connected();
  const result = await client.callTool({ name: "hc_templates", arguments: {} });
  assert.notEqual(result.isError, true);
  await client.close();
});

test("hc_file_edit rejects mismatched old/new lengths without calling hc", async () => {
  const client = await connected();
  const result = await client.callTool({
    name: "hc_file_edit",
    arguments: { path: "x.txt", old: ["a", "b"], new: ["c"] },
  });
  assert.equal(result.isError, true);
  await client.close();
});

test("hc_exec with a real argv returns clean JSON and doesn't leak --json into the child's own args", async () => {
  const client = await connected();
  const result = await client.callTool({ name: "hc_exec", arguments: { argv: ["echo", "sentinel-value"] } });
  assert.notEqual(result.isError, true);
  const parsed = JSON.parse(result.content[0].text);
  const decoded = Buffer.from(parsed.stdout, "base64").toString().trim();
  assert.equal(decoded, "sentinel-value");
  await client.close();
});

test("hc_events resolves quickly on a quiet system", async () => {
  const client = await connected();
  const started = Date.now();
  const result = await client.callTool({ name: "hc_events", arguments: { wait_ms: 300 } });
  assert.notEqual(result.isError, true);
  assert.ok(Date.now() - started < 3000);
  await client.close();
});
