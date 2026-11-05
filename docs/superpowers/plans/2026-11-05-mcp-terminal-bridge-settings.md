# MCP Terminal Bridge + Settings Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give any MCP-capable agent full, structured, 1:1 access to `hc`'s terminal commands (across every machine `hc` already knows about), and a Settings page in the Herdr app (opened like Files/Changes) to install/remove that bridge from Claude Code.

**Architecture:** A standalone Node.js stdio MCP server (`mcp/`) translates each kept `hc` subcommand into one MCP tool via a generic argv-builder driven by a declarative table, shelling out with `--json` forced and never throwing on failure. A new `natsu-settings` gpui-kit mod (left section list / right content, 2:8) shows that server's install status and a button that runs `claude mcp add`/`remove`. A cloned `natsu-tabs` mod adds the "Settings" button next to Files/Changes, wired into this repo's `natsu` layout.

**Tech Stack:** Node.js 22 (`node:child_process`, `node:test`), `@modelcontextprotocol/sdk` 1.32.x, `zod` 4.x, for the server. gpui-kit (JS) for the mods, following this repo's existing conventions.

**Spec:** `docs/superpowers/specs/2026-11-05-mcp-terminal-bridge-settings-design.md`

## Global Constraints

- Full access, no permission scoping on any tool (per spec).
- Excluded from tools (per spec): `attach`, `connect`, `server start/stop/status/restart`, `update`, `schema`. `events` is a poll-once tool, not a held-open stream.
- Registration is local-only (this machine), Claude Code only (`claude mcp add`/`remove`), scope `user`, server name `natsu-hc`.
- Node.js is assumed installed; if missing, the Settings page reports it and does not attempt to install it.
- Every `hc` invocation from the server forces `--json` (hc defaults to text for `run`/`read` outside a pipe).
- Every `exec()` call from the Settings mod (`claude`, `npm`, `node --version`) is wrapped so a rejection (missing binary) is treated the same as a nonzero exit, not an unhandled throw — `herdr`'s own `exec()` **rejects** on a program that can't start, per `AGENTS.md`.
- Live file paths follow this repo's existing convention (`natsu-folders`'s README): the repo lives at `~/.config/herdr-app/mods/herdr-natsu/`; new/cloned mods are created inside it and symlinked out to `~/.config/herdr-app/mods/<name>/`.
- `herdr-app check <mod folder>` must pass for every mod folder this plan creates or clones, before it's considered done.

## Review Focus

- `hc` missing from PATH entirely — every MCP tool call must return a clear error (not a Node ENOENT stack), and the Settings page must show it, not silently look "not registered".
- `claude` CLI missing or not on PATH — `exec()` **rejects**; the Settings mod's status refresh and Install/Remove actions must catch that rejection, not crash the mod.
- `hc_file_edit` called with mismatched `old`/`new` array lengths — must be rejected before ever shelling out to `hc`.
- Clicking Install (or Remove) again while one is already in flight — must be a no-op, not a second overlapping `npm install`/`claude mcp add`.
- `hc events` producing no output inside the wait window (a quiet system) — `hc_events` must resolve with an empty list quickly, never hang until some external timeout.

---

## Task 1: `mcp/hc.js` — the `hc` process wrapper

**Files:**
- Create: `mcp/package.json`
- Create: `mcp/hc.js`
- Test: `mcp/hc.test.js`

**Interfaces:**
- Produces: `runHc(args: string[], opts?: { stdin?: string, bin?: string }) -> Promise<{ code: number|null, stdout: string, stderr: string }>` — always resolves, never rejects; `code: null` means the binary couldn't be spawned (`stderr` holds why).
- Produces: `runHcTimed(args: string[], waitMs: number, opts?: { bin?: string }) -> Promise<{ lines: string[] } | { lines: [], error: string }>` — spawns, collects stdout lines for `waitMs` ms, then kills the child and resolves; never rejects, never outlives `waitMs` by more than normal process-kill latency.
- Produces: `toToolContent(result: { code, stdout, stderr }) -> { content: [{ type: "text", text: string }], isError?: true }` — `code === null` or `code !== 0` → `isError: true` with a readable message; `code === 0` → the parsed JSON (or raw text if it didn't parse) as the text.

- [ ] **Step 1: Write `mcp/package.json`**

```json
{
  "name": "natsu-hc-mcp",
  "private": true,
  "type": "module",
  "version": "0.1.0",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.32.2",
    "zod": "^4.6.7"
  }
}
```

- [ ] **Step 2: Run `npm install` in `mcp/`**

Run: `cd mcp && npm install`
Expected: exits 0, creates `mcp/node_modules` and `mcp/package-lock.json`.

- [ ] **Step 3: Write the failing tests in `mcp/hc.test.js`**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { runHc, runHcTimed, toToolContent } from "./hc.js";

test("toToolContent: success with JSON stdout", () => {
  const r = toToolContent({ code: 0, stdout: '{"a":1}\n', stderr: "" });
  assert.equal(r.isError, undefined);
  assert.deepEqual(JSON.parse(r.content[0].text), { a: 1 });
});

test("toToolContent: success with non-JSON stdout returns raw text", () => {
  const r = toToolContent({ code: 0, stdout: "plain text\n", stderr: "" });
  assert.equal(r.isError, undefined);
  assert.equal(r.content[0].text, "plain text\n");
});

test("toToolContent: nonzero exit is an error, never thrown", () => {
  const r = toToolContent({ code: 2, stdout: "", stderr: "boom" });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /boom/);
});

test("toToolContent: code null (binary not found) is an error", () => {
  const r = toToolContent({ code: null, stdout: "", stderr: "hc not found on PATH" });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /not found on PATH/);
});

test("runHc: missing binary resolves with code null, never rejects", async () => {
  const r = await runHc(["ls"], { bin: "definitely-not-a-real-binary-xyz" });
  assert.equal(r.code, null);
  assert.match(r.stderr, /not found on PATH/);
});

test("runHc: real hc ls --json succeeds (requires hc on PATH)", async () => {
  const r = await runHc(["ls"]);
  assert.equal(r.code, 0);
  assert.doesNotThrow(() => JSON.parse(r.stdout));
});

test("runHcTimed: missing binary resolves with empty lines and an error, never rejects", async () => {
  const r = await runHcTimed(["events"], 200, { bin: "definitely-not-a-real-binary-xyz" });
  assert.deepEqual(r.lines, []);
  assert.match(r.error, /not found on PATH/);
});

test("runHcTimed: real hc events stops within the wait window on a quiet system", async () => {
  const started = Date.now();
  const r = await runHcTimed(["events"], 300);
  assert.ok(Array.isArray(r.lines));
  assert.ok(Date.now() - started < 3000);
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd mcp && node --test hc.test.js`
Expected: FAIL — `hc.js` does not exist yet.

- [ ] **Step 5: Implement `mcp/hc.js`**

```js
import { execFile, spawn } from "node:child_process";

export function runHc(args, { stdin, bin = "hc" } = {}) {
  return new Promise((resolve) => {
    const child = execFile(bin, [...args, "--json"], { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
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
    const child = spawn(bin, [...args, "--json"]);
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
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd mcp && node --test hc.test.js`
Expected: PASS (all 8 tests). The two tests that call real `hc` require it on PATH, as it already is in this environment.

- [ ] **Step 7: Commit**

```bash
git add mcp/package.json mcp/package-lock.json mcp/hc.js mcp/hc.test.js
git commit -m "Add hc process wrapper for the natsu-hc MCP server"
```

---

## Task 2: `mcp/build-argv.js` — generic argv builder

**Files:**
- Create: `mcp/build-argv.js`
- Test: `mcp/build-argv.test.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `buildArgv(def: { cmd: string[], args: ArgSpec[] }, input: object) -> string[]`, where `ArgSpec` is `{ field: string, kind: "bool"|"value"|"repeat"|"positional"|"positionalArray", flag?: string }`. Task 3 and 4 build every tool's `cmd`/`args` on this contract.
- Convention every later task follows: list flag (`bool`/`value`/`repeat`) entries before positional (`positional`/`positionalArray`) entries, in the same relative order as that subcommand's own `--help` output.

- [ ] **Step 1: Write the failing tests in `mcp/build-argv.test.js`**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { buildArgv } from "./build-argv.js";

test("bool: flag appears only when the field is truthy", () => {
  const def = { cmd: ["ls"], args: [{ field: "all", flag: "--all", kind: "bool" }] };
  assert.deepEqual(buildArgv(def, { all: true }), ["ls", "--all"]);
  assert.deepEqual(buildArgv(def, { all: false }), ["ls"]);
  assert.deepEqual(buildArgv(def, {}), ["ls"]);
});

test("value: flag plus stringified value when present", () => {
  const def = { cmd: ["read"], args: [{ field: "lines", flag: "--lines", kind: "value" }] };
  assert.deepEqual(buildArgv(def, { lines: 20 }), ["read", "--lines", "20"]);
  assert.deepEqual(buildArgv(def, {}), ["read"]);
});

test("repeat: flag repeated once per array element", () => {
  const def = { cmd: ["ls"], args: [{ field: "label", flag: "--label", kind: "repeat" }] };
  assert.deepEqual(buildArgv(def, { label: ["a=1", "b=2"] }), ["ls", "--label", "a=1", "--label", "b=2"]);
  assert.deepEqual(buildArgv(def, {}), ["ls"]);
});

test("positional and positionalArray append raw values after flags", () => {
  const def = {
    cmd: ["label"],
    args: [{ field: "terminal", kind: "positional" }, { field: "pairs", kind: "positionalArray" }],
  };
  assert.deepEqual(buildArgv(def, { terminal: "t7", pairs: ["a=1", "b="] }), ["label", "t7", "a=1", "b="]);
});

test("matches the real hc_send shape: flags before positionals, in --help order", () => {
  const def = {
    cmd: ["send"],
    args: [
      { field: "force", flag: "--force", kind: "bool" },
      { field: "if", flag: "--if", kind: "value" },
      { field: "wait", flag: "--wait", kind: "bool" },
      { field: "timeout", flag: "--timeout", kind: "value" },
      { field: "terminal", kind: "positional" },
      { field: "text", kind: "positional" },
    ],
  };
  assert.deepEqual(buildArgv(def, { terminal: "t7", text: "hi" }), ["send", "t7", "hi"]);
  assert.deepEqual(
    buildArgv(def, { terminal: "t7", text: "hi", force: true, wait: true, timeout: 30 }),
    ["send", "--force", "--wait", "--timeout", "30", "t7", "hi"],
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mcp && node --test build-argv.test.js`
Expected: FAIL — `build-argv.js` does not exist yet.

- [ ] **Step 3: Implement `buildArgv(def, input)` in `mcp/build-argv.js`**

```js
export function buildArgv(def, input) {
  const argv = [...def.cmd];
  for (const a of def.args) {
    const v = input[a.field];
    if (v === undefined || v === null || v === false) continue;
    if (a.kind === "bool") argv.push(a.flag);
    else if (a.kind === "value") argv.push(a.flag, String(v));
    else if (a.kind === "repeat") for (const item of v) argv.push(a.flag, String(item));
    else if (a.kind === "positional") argv.push(String(v));
    else if (a.kind === "positionalArray") for (const item of v) argv.push(String(item));
    else throw new Error(`buildArgv: unknown arg kind "${a.kind}"`);
  }
  return argv;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mcp && node --test build-argv.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp/build-argv.js mcp/build-argv.test.js
git commit -m "Add generic hc argv builder"
```

---

## Task 3: `mcp/tools.js` — the full tool table

**Files:**
- Create: `mcp/tools.js`
- Test: `mcp/tools.test.js`

**Interfaces:**
- Consumes: `buildArgv` from Task 2 (for its own tests only — `tools.js` itself doesn't call it).
- Produces: `TOOLS: ToolDef[]` where `ToolDef = { name: string, description: string, cmd: string[], schema: ZodRawShape, args: ArgSpec[], special？: true, validate?: (input) => string|null }`. `name` is always `hc_<subcommand>` (`_` joining multi-word subcommands, e.g. `hc_machine_ls`, `hc_file_read`). Entries with `special: true` (`hc_exec`, `hc_file_write`, `hc_events`) are not dispatched generically by Task 4 — their `cmd`/`args` are still used, by a dedicated handler, as described in Task 4.

- [ ] **Step 1: Write the failing tests in `mcp/tools.test.js`**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { TOOLS } from "./tools.js";
import { buildArgv } from "./build-argv.js";

test("exactly 25 tools, every name prefixed hc_ and unique", () => {
  assert.equal(TOOLS.length, 25);
  const names = TOOLS.map((t) => t.name);
  assert.equal(new Set(names).size, 25);
  for (const n of names) assert.match(n, /^hc_/);
});

test("every entry has cmd, schema and (args or special)", () => {
  for (const t of TOOLS) {
    assert.ok(Array.isArray(t.cmd) && t.cmd.length > 0, t.name);
    assert.ok(typeof t.schema === "object", t.name);
    assert.ok(Array.isArray(t.args), t.name);
  }
});

test("hc_run builds flags before the trailing argv", () => {
  const def = TOOLS.find((t) => t.name === "hc_run");
  assert.deepEqual(
    buildArgv(def, { bg: true, cwd: "/tmp", argv: ["claude"] }),
    ["run", "--cwd", "/tmp", "--bg", "claude"],
  );
});

test("hc_label builds terminal then the k=v pairs", () => {
  const def = TOOLS.find((t) => t.name === "hc_label");
  assert.deepEqual(buildArgv(def, { terminal: "t7", labels: ["a=1", "b="] }), ["label", "t7", "a=1", "b="]);
});

test("hc_file_edit.validate rejects mismatched old/new lengths", () => {
  const def = TOOLS.find((t) => t.name === "hc_file_edit");
  assert.equal(def.validate({ old: ["a"], new: ["b", "c"] }) !== null, true);
  assert.equal(def.validate({ old: ["a"], new: ["b"] }), null);
});

test("hc_machine_rename builds machine then new_name", () => {
  const def = TOOLS.find((t) => t.name === "hc_machine_rename");
  assert.deepEqual(buildArgv(def, { machine: "vps", new_name: "prod" }), ["machine", "rename", "vps", "prod"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mcp && node --test tools.test.js`
Expected: FAIL — `tools.js` does not exist yet.

- [ ] **Step 3: Implement `mcp/tools.js`**

Every subcommand's flags below were read directly from that subcommand's own `--help` on 2026-11-05 (`hc <command> --help`); field names are chosen to match the CLI's own flag names with dashes turned to underscores.

```js
import { z } from "zod";

export const TOOLS = [
  {
    name: "hc_run", cmd: ["run"],
    description: "Start a program, or a template by name with its task, in a new terminal (hc run)",
    schema: {
      argv: z.array(z.string()).optional(), name: z.string().optional(), cwd: z.string().optional(),
      on: z.string().optional(), label: z.array(z.string()).optional(), parent: z.string().optional(),
      no_parent: z.boolean().optional(), no_notify: z.boolean().optional(), outlive_parent: z.boolean().optional(),
      rm: z.boolean().optional(), keep: z.boolean().optional(), bg: z.boolean().optional(), timeout: z.number().optional(),
    },
    args: [
      { field: "name", flag: "--name", kind: "value" },
      { field: "cwd", flag: "--cwd", kind: "value" },
      { field: "on", flag: "--on", kind: "value" },
      { field: "label", flag: "--label", kind: "repeat" },
      { field: "parent", flag: "--parent", kind: "value" },
      { field: "no_parent", flag: "--no-parent", kind: "bool" },
      { field: "no_notify", flag: "--no-notify", kind: "bool" },
      { field: "outlive_parent", flag: "--outlive-parent", kind: "bool" },
      { field: "rm", flag: "--rm", kind: "bool" },
      { field: "keep", flag: "--keep", kind: "bool" },
      { field: "bg", flag: "--bg", kind: "bool" },
      { field: "timeout", flag: "--timeout", kind: "value" },
      { field: "argv", kind: "positionalArray" },
    ],
  },
  {
    name: "hc_ls", cmd: ["ls"], description: "List live terminals (hc ls)",
    schema: { all: z.boolean().optional(), label: z.array(z.string()).optional() },
    args: [{ field: "all", flag: "--all", kind: "bool" }, { field: "label", flag: "--label", kind: "repeat" }],
  },
  {
    name: "hc_get", cmd: ["get"], description: "Show one terminal (hc get)",
    schema: { terminal: z.string() }, args: [{ field: "terminal", kind: "positional" }],
  },
  {
    name: "hc_read", cmd: ["read"], description: "Print a terminal's screen and history (hc read)",
    schema: { terminal: z.string(), lines: z.number().optional() },
    args: [{ field: "lines", flag: "--lines", kind: "value" }, { field: "terminal", kind: "positional" }],
  },
  {
    name: "hc_kill", cmd: ["kill"], description: "End a terminal's program: hangup, then escalate (hc kill)",
    schema: { terminal: z.string() }, args: [{ field: "terminal", kind: "positional" }],
  },
  {
    name: "hc_rm", cmd: ["rm"], description: "Remove a finished terminal (hc rm)",
    schema: { terminal: z.string() }, args: [{ field: "terminal", kind: "positional" }],
  },
  {
    name: "hc_label", cmd: ["label"], description: "Set labels on a terminal; key= removes one (hc label)",
    schema: { terminal: z.string(), labels: z.array(z.string()).min(1) },
    args: [{ field: "terminal", kind: "positional" }, { field: "labels", kind: "positionalArray" }],
  },
  {
    name: "hc_keep", cmd: ["keep"], description: "Keep a live terminal after loss, or stop with off (hc keep)",
    schema: { terminal: z.string(), off: z.boolean().optional() },
    args: [{ field: "off", flag: "--off", kind: "bool" }, { field: "terminal", kind: "positional" }],
  },
  {
    name: "hc_send", cmd: ["send"], description: "Paste text into a terminal and press Enter (hc send)",
    schema: {
      terminal: z.string(), text: z.string(), force: z.boolean().optional(),
      if: z.enum(["idle", "working"]).optional(), wait: z.boolean().optional(), timeout: z.number().optional(),
    },
    args: [
      { field: "force", flag: "--force", kind: "bool" },
      { field: "if", flag: "--if", kind: "value" },
      { field: "wait", flag: "--wait", kind: "bool" },
      { field: "timeout", flag: "--timeout", kind: "value" },
      { field: "terminal", kind: "positional" },
      { field: "text", kind: "positional" },
    ],
  },
  {
    name: "hc_keys", cmd: ["keys"], description: "Press named keys: enter, esc, up, ctrl+c, ... (hc keys)",
    schema: { terminal: z.string(), keys: z.array(z.string()).min(1) },
    args: [{ field: "terminal", kind: "positional" }, { field: "keys", kind: "positionalArray" }],
  },
  {
    name: "hc_interrupt", cmd: ["interrupt"], description: "Press the stop key and report what happened (hc interrupt)",
    schema: { terminal: z.string(), timeout: z.number().optional() },
    args: [{ field: "timeout", flag: "--timeout", kind: "value" }, { field: "terminal", kind: "positional" }],
  },
  {
    name: "hc_wait", cmd: ["wait"], description: "Wait until a terminal stops working, or for its children (hc wait)",
    schema: {
      terminal: z.string().optional(), children: z.enum(["any", "all"]).optional(),
      output: z.string().optional(), timeout: z.number().optional(),
    },
    args: [
      { field: "children", flag: "--children", kind: "value" },
      { field: "output", flag: "--output", kind: "value" },
      { field: "timeout", flag: "--timeout", kind: "value" },
      { field: "terminal", kind: "positional" },
    ],
  },
  {
    name: "hc_put", cmd: ["put"], description: "Send a local file beside a terminal, on its machine (hc put)",
    schema: { terminal: z.string(), file: z.string() },
    args: [{ field: "terminal", kind: "positional" }, { field: "file", kind: "positional" }],
  },
  {
    name: "hc_exec", cmd: ["exec"], special: true,
    description: "Run one program without a terminal, here or on a machine (hc exec)",
    schema: {
      argv: z.array(z.string()).min(1), on: z.string().optional(), cwd: z.string().optional(),
      env: z.array(z.string()).optional(), timeout: z.number().optional(), stdin: z.string().optional(),
    },
    args: [
      { field: "on", flag: "--on", kind: "value" },
      { field: "cwd", flag: "--cwd", kind: "value" },
      { field: "env", flag: "--env", kind: "repeat" },
      { field: "timeout", flag: "--timeout", kind: "value" },
    ],
  },
  {
    name: "hc_file_read", cmd: ["file", "read"], description: "Print a text file, here or on a machine (hc file read)",
    schema: {
      path: z.string(), on: z.string().optional(), cwd: z.string().optional(),
      offset: z.number().optional(), limit: z.number().optional(),
    },
    args: [
      { field: "on", flag: "--on", kind: "value" },
      { field: "cwd", flag: "--cwd", kind: "value" },
      { field: "offset", flag: "--offset", kind: "value" },
      { field: "limit", flag: "--limit", kind: "value" },
      { field: "path", kind: "positional" },
    ],
  },
  {
    name: "hc_file_write", cmd: ["file", "write"], special: true,
    description: "Write content as a file, here or on a machine, making missing folders (hc file write)",
    schema: { path: z.string(), content: z.string(), on: z.string().optional(), cwd: z.string().optional() },
    args: [
      { field: "on", flag: "--on", kind: "value" },
      { field: "cwd", flag: "--cwd", kind: "value" },
      { field: "path", kind: "positional" },
    ],
  },
  {
    name: "hc_file_edit", cmd: ["file", "edit"],
    description: "Replace exact text found once in a file, here or on a machine; all or none (hc file edit)",
    schema: {
      path: z.string(), on: z.string().optional(), cwd: z.string().optional(),
      old: z.array(z.string()).min(1), new: z.array(z.string()).min(1),
    },
    args: [
      { field: "on", flag: "--on", kind: "value" },
      { field: "cwd", flag: "--cwd", kind: "value" },
      { field: "old", flag: "--old", kind: "repeat" },
      { field: "new", flag: "--new", kind: "repeat" },
      { field: "path", kind: "positional" },
    ],
    validate: (input) => (input.old.length === input.new.length ? null : "old and new must have the same length"),
  },
  {
    name: "hc_templates", cmd: ["templates"], description: "List templates runnable by name (hc templates)",
    schema: {}, args: [],
  },
  {
    name: "hc_events", cmd: ["events"], special: true,
    description: "Poll fact changes for a short window instead of streaming forever (hc events)",
    schema: {
      terminal: z.string().optional(), children_of: z.string().optional(),
      label: z.array(z.string()).optional(), wait_ms: z.number().optional(),
    },
    args: [
      { field: "terminal", flag: "--terminal", kind: "value" },
      { field: "children_of", flag: "--children-of", kind: "value" },
      { field: "label", flag: "--label", kind: "repeat" },
    ],
  },
  {
    name: "hc_machine_ls", cmd: ["machine", "ls"], description: "List the machines added here (hc machine ls)",
    schema: {}, args: [],
  },
  {
    name: "hc_machine_add", cmd: ["machine", "add"], description: "Add a machine reached over ssh (hc machine add)",
    schema: {
      target: z.string().optional(), via: z.string().optional(), temp: z.boolean().optional(),
      install: z.boolean().optional(), name: z.string().optional(), session: z.string().optional(),
    },
    args: [
      { field: "via", flag: "--via", kind: "value" },
      { field: "temp", flag: "--temp", kind: "bool" },
      { field: "install", flag: "--install", kind: "bool" },
      { field: "name", flag: "--name", kind: "value" },
      { field: "session", flag: "--session", kind: "value" },
      { field: "target", kind: "positional" },
    ],
  },
  {
    name: "hc_machine_login", cmd: ["machine", "login"],
    description: "Log in again on a machine that says it needs it (hc machine login)",
    schema: { machine: z.string() }, args: [{ field: "machine", kind: "positional" }],
  },
  {
    name: "hc_machine_update", cmd: ["machine", "update"],
    description: "Copy this hc to a machine and restart it there (hc machine update)",
    schema: { machine: z.string() }, args: [{ field: "machine", kind: "positional" }],
  },
  {
    name: "hc_machine_rename", cmd: ["machine", "rename"], description: "Give a machine a new name here (hc machine rename)",
    schema: { machine: z.string(), new_name: z.string() },
    args: [{ field: "machine", kind: "positional" }, { field: "new_name", kind: "positional" }],
  },
  {
    name: "hc_machine_rm", cmd: ["machine", "rm"], description: "Forget a machine; its terminals keep running there (hc machine rm)",
    schema: { machine: z.string() }, args: [{ field: "machine", kind: "positional" }],
  },
];
```

(Count check: run, ls, get, read, kill, rm, label, keep, send, keys, interrupt, wait, put, exec, file_read, file_write, file_edit, templates, events, machine_ls, machine_add, machine_login, machine_update, machine_rename, machine_rm = 25.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mcp && node --test tools.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add mcp/tools.js mcp/tools.test.js
git commit -m "Add the full hc-to-MCP tool table"
```

---

## Task 4: `mcp/server.js` — wire the MCP server

**Files:**
- Create: `mcp/server.js`
- Test: `mcp/server.test.js`

**Interfaces:**
- Consumes: `runHc`, `runHcTimed`, `toToolContent` (Task 1); `buildArgv` (Task 2); `TOOLS` (Task 3).
- Produces: `createServer() -> McpServer` (registers every tool, does not connect any transport — used by tests and by the `import.meta.url` guard below). Running `node mcp/server.js` directly starts it over stdio.

- [ ] **Step 1: Write the failing tests in `mcp/server.test.js`**

```js
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

test("hc_events resolves quickly on a quiet system", async () => {
  const client = await connected();
  const started = Date.now();
  const result = await client.callTool({ name: "hc_events", arguments: { wait_ms: 300 } });
  assert.notEqual(result.isError, true);
  assert.ok(Date.now() - started < 3000);
  await client.close();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd mcp && node --test server.test.js`
Expected: FAIL — `server.js` does not exist yet.

- [ ] **Step 3: Implement `mcp/server.js`**

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd mcp && node --test server.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Manual smoke test that stdio actually starts**

Run: `cd mcp && node server.js` then press Ctrl+C after a couple of seconds.
Expected: the process stays running (waiting on stdin) and exits cleanly on Ctrl+C — no stack trace on startup.

- [ ] **Step 6: Commit**

```bash
git add mcp/server.js mcp/server.test.js
git commit -m "Wire the natsu-hc MCP server over stdio"
```

---

## Task 5: `mods/natsu-settings` — the Settings mod

**Files:**
- Create: `mods/natsu-settings/mod.json`
- Create: `mods/natsu-settings/main.js`
- Create: `mods/natsu-settings/gear.svg`

**Interfaces:**
- Consumes: nothing from Tasks 1-4 directly (it shells out to `claude`/`npm`/`node`, and reads `mcp/node_modules`'s presence, as a sibling of its own mod folder's grandparent — see paths below). It does know the MCP install target is `mcp/server.js`, the same file Task 4 created.
- Produces: a mod named `natsu-settings`, referenced by `layouts/natsu.json` in Task 6 as `content.mod: "natsu-settings"`.

There is no `node:test`-style harness for gpui-kit mods (per `AGENTS.md`); this task is verified with `herdr-app check` plus exercising it in the running app (Task 6, since it only becomes visible once wired into the layout).

- [ ] **Step 1: Write `mods/natsu-settings/mod.json`**

```json
{ "place": "none", "title": "Natsu settings" }
```

- [ ] **Step 2: Write `mods/natsu-settings/gear.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
  <circle cx="12" cy="12" r="3" />
</svg>
```

- [ ] **Step 3: Implement `mods/natsu-settings/main.js`**

Signature: default-exported class `NatsuSettings extends View`, with `init(_props, cx)`, `render(cx)`, and helper methods `refresh(cx)`, `install(cx)`, `remove(cx)`, `mcpSection(t)`, `button(t, label, busy, onClick)`. Every `exec()` call goes through a local `safeExec` that turns a rejection into the same `{ code: null, stdout: "", stderr }` shape `mcp/hc.js`'s `runHc` uses, so a missing `claude`/`npm`/`node`/`hc` binary shows up as a status line, never a crash (Review Focus: `claude` CLI missing, `hc` missing). `install`/`remove` both check `this.busy` first and return immediately if set, so a second click while one is in flight is a no-op (Review Focus: double-click).

```js
import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, exec, home } from "herdr";
import * as fs from "fs/promises";

const MCP_NAME = "natsu-hc";
const REPO_REL = "mods/herdr-natsu/mcp";
const MCP_DIR = `${home()}/.config/herdr-app/${REPO_REL}`;

function safeExec(cmd, args, opts) {
  return exec(cmd, args, opts).catch((err) => ({ code: null, stdout: "", stderr: String(err?.message ?? err) }));
}

export default class NatsuSettings extends View {
  init(_props, cx) {
    this.active = "mcp";
    this.busy = false;
    this.lastError = null;
    this.status = { node: null, claude: null, registered: null, depsReady: null };
    this.refresh(cx);
  }

  async refresh(cx) {
    const node = await safeExec("node", ["--version"]);
    const hc = await safeExec("hc", ["--version"]);
    const claudeList = await safeExec("claude", ["mcp", "list"]);
    const depsReady = await fs.stat(`${REPO_REL}/node_modules`).then(() => true).catch(() => false);
    this.status = {
      node: node.code === 0,
      hc: hc.code === 0,
      claude: claudeList.code === 0,
      registered: claudeList.code === 0 && claudeList.stdout.includes(MCP_NAME),
      depsReady,
    };
    cx.notify();
  }

  async install(cx) {
    if (this.busy) return;
    this.busy = true;
    this.lastError = null;
    cx.notify();
    if (!this.status.depsReady) {
      const npm = await safeExec("npm", ["install"], { cwd: MCP_DIR });
      if (npm.code !== 0) {
        this.lastError = npm.stderr || "npm install failed";
        this.busy = false;
        cx.notify();
        return;
      }
    }
    const add = await safeExec("claude", ["mcp", "add", "-s", "user", MCP_NAME, "--", "node", `${MCP_DIR}/server.js`]);
    if (add.code !== 0) this.lastError = add.stderr || "claude mcp add failed";
    await this.refresh(cx);
    this.busy = false;
    cx.notify();
  }

  async remove(cx) {
    if (this.busy) return;
    this.busy = true;
    this.lastError = null;
    cx.notify();
    const rm = await safeExec("claude", ["mcp", "remove", "-s", "user", MCP_NAME]);
    if (rm.code !== 0) this.lastError = rm.stderr || "claude mcp remove failed";
    await this.refresh(cx);
    this.busy = false;
    cx.notify();
  }

  button(t, label, busy, onClick) {
    return div().id(`settings-btn-${label}`).px(12).h(28).rounded(6).items_center().justify_center()
      .bg(busy ? t.chrome : t.solid).text_color(busy ? t.dim : t.solid_foreground)
      .when(!busy, (el) => el.cursor_pointer().hover((s) => s.bg(t.accent)).on_click((_e, cx) => onClick(cx)))
      .child(busy ? "…" : label);
  }

  mcpSection(t) {
    const row = (label, ok) => h_flex().gap(6).items_center()
      .child(div().size(7).rounded(4).bg(ok == null ? t.dim : ok ? (t.done ?? t.accent) : t.blocked))
      .child(div().text_color(t.foreground).child(label));
    return v_flex().gap(10)
      .child(div().font_semibold().text_size(14).child("MCP: natsu-hc"))
      .child(row("Node.js on PATH", this.status.node))
      .child(row("hc on PATH", this.status.hc))
      .child(row("Claude Code CLI on PATH", this.status.claude))
      .child(row("Server dependencies installed", this.status.depsReady))
      .child(row(this.status.registered ? "Registered with Claude Code" : "Not registered", this.status.registered))
      .child(div().text_size(12).text_color(t.dim).child(`${MCP_DIR}/server.js`))
      .when(Boolean(this.lastError), (el) => el.child(div().text_color(t.blocked).text_size(12).child(this.lastError)))
      .child(h_flex().gap(8)
        .when(!this.status.registered, (el) => el.child(this.button(t, "Install", this.busy, (cx) => this.install(cx))))
        .when(Boolean(this.status.registered), (el) => el.child(this.button(t, "Remove", this.busy, (cx) => this.remove(cx)))));
  }

  render(cx) {
    const t = theme();
    const sections = [{ id: "mcp", label: "MCP" }];
    const left = v_flex().flex_basis(0).flex_grow(2).min_w(120).bg(t.chrome).border_r(1).border_color(t.border).p(8).gap(2)
      .children(sections.map((s) => div().id(`settings-${s.id}`).px(8).h(28).rounded(6).items_center()
        .bg(this.active === s.id ? t.selected : "transparent").text_color(t.foreground)
        .cursor_pointer().hover((el) => el.bg(t.hover)).on_click((_e, cx) => { this.active = s.id; cx.notify(); }).child(s.label)));
    const right = v_flex().flex_basis(0).flex_grow(8).p(16).gap(10).child(this.mcpSection(t));
    return h_flex().size_full().bg(t.background).child(left).child(right);
  }
}
```

- [ ] **Step 4: `herdr-app check`**

Run: `herdr-app check mods/natsu-settings`
Expected: exits 0, no errors printed.

- [ ] **Step 5: Commit**

```bash
git add mods/natsu-settings
git commit -m "Add natsu-settings mod: MCP install status and Install/Remove"
```

---

## Task 6: Settings button, layout wiring, and end-to-end verification

**Files:**
- Create (via clone, then hand-edit): `mods/natsu-tabs/main.js`, `mods/natsu-tabs/mod.json`
- Modify: `layouts/natsu.json`

**Interfaces:**
- Consumes: `natsu-settings` (Task 5) by mod name only, as `layouts/natsu.json`'s new `panel-body` child.

- [ ] **Step 1: Clone the shipped `tabs` mod**

Run: `herdr-app do mod.clone --name tabs --as natsu-tabs`
Expected: prints the clone's result; creates `~/.config/herdr-app/mods/natsu-tabs/` (a real folder, not a symlink — `mod.clone` always writes into the live mods folder).

- [ ] **Step 2: Move the clone into this repo and symlink it back, matching `natsu-folders`'s own convention**

Run (from the repo root, `~/.config/herdr-app/mods/herdr-natsu`):
```bash
mkdir -p mods/natsu-tabs
mv ~/.config/herdr-app/mods/natsu-tabs/* mods/natsu-tabs/
rmdir ~/.config/herdr-app/mods/natsu-tabs
ln -s "$(pwd)/mods/natsu-tabs" ~/.config/herdr-app/mods/natsu-tabs
```
Expected: `mods/natsu-tabs/main.js` and `mods/natsu-tabs/mod.json` now live in the repo; `~/.config/herdr-app/mods/natsu-tabs` is a symlink to them (verify with `ls -la ~/.config/herdr-app/mods/natsu-tabs`).

- [ ] **Step 3: Edit `mods/natsu-tabs/main.js`: add the Settings button**

Two changes to the clone (which starts byte-identical to `~/.config/herdr-app/mods/tabs/main.js`):

1. Change the default panels line from
   `const enabled = shared("workspace.panels") ?? ["files", "changes"];`
   to
   `const enabled = shared("workspace.panels") ?? ["files", "changes", "settings"];`
   so the button shows without the person needing to touch `workspace.panels` themselves.

2. Immediately after the existing `.when(enabled.includes("changes"), ...)` line (the Changes button), add:
   ```js
   .when(enabled.includes("settings"), el => el.child(panelButton("settings", "Settings", "mods/natsu-settings/gear.svg")))
   ```

- [ ] **Step 4: `herdr-app check`**

Run: `herdr-app check mods/natsu-tabs`
Expected: exits 0, no errors.

- [ ] **Step 5: Edit `layouts/natsu.json`**

Two changes:

1. The `tabs` block's `content.mod`: change `"tabs"` to `"natsu-tabs"`.
2. The `panel-body` stack's `children` array (currently `files`, `changes`): add a third entry
   ```json
   { "id": "settings", "type": "block", "content": { "mod": "natsu-settings" } }
   ```

- [ ] **Step 6: Confirm the live layout picked up the change with no errors**

Run: `herdr-app status`
Expected: `"layout": "natsu"` (already the active layout in this environment) and `"errors": []`. If `layout.error` is non-empty, fix the JSON before continuing — this layout is live and failing edits fall back to the last good version, per `AGENTS.md`.

- [ ] **Step 7: Drive the new button through `herdr-app do` and look at it**

```bash
herdr-app do layout.select --stack panel-body --child settings
herdr-app do layout.show --id panel
herdr-app shot
```
Expected: `herdr-app status` still shows no errors; the saved PNG shows the panel open on the right with the "MCP: natsu-hc" heading, the status rows, and an Install button (assuming `natsu-hc` isn't registered yet). Also confirm the tab bar itself shows all three buttons (Files, Changes, Settings) via the same screenshot.

- [ ] **Step 8: Exercise Install/Remove for real**

From a plain terminal:
```bash
claude mcp list   # confirm natsu-hc is NOT listed yet
```
Then click Install in the app (or, to test the same logic headlessly first: `cd mcp && npm install && claude mcp add -s user natsu-hc -- node "$(pwd)/server.js"`).
Expected: `claude mcp list` now shows `natsu-hc`; `herdr-app shot` after re-selecting the settings panel shows "Registered with Claude Code" and a Remove button instead. Click Remove (or run `claude mcp remove -s user natsu-hc`) and confirm `claude mcp list` no longer shows it and the page reverts to showing Install.

- [ ] **Step 9: End-to-end tool call with two terminals**

With `natsu-hc` registered, open two terminals in Herdr (A and B), note A's address (`hc ls`). From an MCP-capable agent in B with `natsu-hc` available, call `hc_send` with `{ "terminal": "<A's address>", "text": "echo hi" }`. Expected: the text appears and runs in terminal A, A's own program keeps running throughout (it isn't taken over), and `hc_ls` called from B lists terminals across every machine `hc machine ls` already knows about, not just the local one.

- [ ] **Step 10: Commit**

```bash
git add mods/natsu-tabs layouts/natsu.json
git commit -m "Add a Settings button next to Files/Changes, wired to natsu-settings"
```
