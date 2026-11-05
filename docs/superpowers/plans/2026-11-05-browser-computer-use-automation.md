# Browser + computer-use automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give agents in Herdr a structured MCP tool surface for browser automation (`agent-browser`) and desktop automation (`cua-driver`), manageable from `natsu-settings`, plus a pane that shows a live-ish screenshot of what the browser is doing.

**Architecture:** Two new local MCP servers register with Claude Code the same way `natsu-hc` already does — `cua-driver` needs only install + `claude mcp add` (it speaks MCP itself); `agent-browser` gets a new thin wrapper (`mcp-browser/`, same `build-argv`/`tools`/`server` shape as `mcp/`). `natsu-settings` generalizes from one hardcoded MCP section to a small array of section definitions so the two new ones are data, not new control flow. A new pane (`natsu-browser-view`) polls `agent-browser screenshot` on a timer and renders the file with `image()`.

**Tech Stack:** Node.js (`"type": "module"`), `@modelcontextprotocol/sdk`, `zod`, Node's built-in test runner (`node --test`), gpui-kit/gpui-base (Herdr mods), PowerShell (cua-driver's own installer).

**Spec:** `docs/superpowers/specs/2026-11-05-browser-computer-use-automation-design.md`

## Global Constraints

- Windows only (this machine) — `cua-driver` install uses its official Windows PowerShell installer; no macOS/Linux path is implemented.
- Every `exec()`/`execFile()` call passes args as an array — never a shell string — because the input traces back to an LLM-controlled agent (spec, Architecture → `mcp-browser/server.js`).
- `fs.stat` is not implemented by Herdr's `fs/promises` shim; any file-existence probe uses `fs.readFile` (established this session, confirmed working).
- Registration status is read from `~/.claude.json`'s `mcpServers` key via `fs.readFile`, never from `claude mcp list` (it health-checks every registered server and can stall — established this session).
- Herdr mods cannot embed a web view (AGENTS.md: "You can't: use HTML, CSS, a web view") — the live-view pane is still-image polling via `image()`, not a WebSocket stream.
- `image()`/`svg()` paths resolve against `~/.config/herdr-app` (the Herdr app root), not against the calling mod's own folder and not an arbitrary absolute path (`gpui-kit.d.ts`'s doc comment on `svg`, which `image` shares). The live-view screenshot target must be a path under `mods/natsu-browser-view/`.
- Every PATH/version check in a `refresh()`-style function is wrapped in the existing `withTimeout(promise, CHECK_TIMEOUT_MS, cx)` helper (3500ms) — no unbounded `await` on a child process.
- `mcp-browser/package.json` dependency versions match `mcp/package.json`'s (`@modelcontextprotocol/sdk ^1.32.2`, `zod ^4.6.7`) unless a task finds a reason to differ.
- `cua-driver` install command: `powershell -NoProfile -Command "irm https://cua.ai/driver/install.ps1 | iex"`. Registration: `claude mcp add --transport stdio -s user cua-driver -- cua-driver mcp`. Removal: `claude mcp remove -s user cua-driver`.

## Review Focus

- `agent-browser` missing from PATH (not installed, or removed after install) when a Browser-section check or any `browser_*`/`agent_browser_exec` tool runs → clean `{error: "agent-browser not found on PATH"}`-shaped result, never a thrown exception or hang.
- Re-clicking Install for `cua-driver` or the browser wrapper when already registered (idempotent) → `claude mcp add`'s "already exists" stderr must not surface as `lastError`, same as the existing `natsu-hc` fix.
- `natsu-browser-view` polls before any `agent-browser open` has run (no active page/tab) → shows the idle placeholder, not a crashed render or a broken-image box.
- `browser_get`'s dynamic subcommand (`get <subcommand> [...args]`) called with something `agent-browser` rejects → still returns the normal `{error: true, code, stdout, stderr}` tool shape via `toToolContent`, not an unhandled throw that bypasses it.
- Clicking Install on one `natsu-settings` section while another section is mid-refresh, or switching nav sections mid-install → each section's `busy`/`lastError`/`status` stays scoped to that section only; one section's in-flight state must never disable or blank another section's UI.

---

## Task 1: `mcp-browser` — argv builder + agent-browser exec helper

**Files:**
- Create: `mcp-browser/package.json`
- Create: `mcp-browser/build-argv.js`
- Create: `mcp-browser/build-argv.test.js`
- Create: `mcp-browser/agent-browser.js`

**Interfaces:**
- Consumes: nothing (first task; mirrors `mcp/build-argv.js` and `mcp/hc.js`, which may be read for reference but are not imported).
- Produces:
  - `build-argv.js`: `export function buildArgv(def, input)` — identical contract to `mcp/build-argv.js`'s version (`def.cmd: string[]`, `def.args: Array<{field, flag?, kind}>` where `kind` is `"bool" | "value" | "repeat" | "positional" | "positionalArray"`).
  - `agent-browser.js`: `export function runAgentBrowser(args: string[], opts?: { bin?: string }): Promise<{code: number|null, stdout: string, stderr: string}>` and `export function toToolContent(result): { content: [{type: "text", text: string}], isError?: true }`.

- [ ] **Step 1: Copy `build-argv.js` verbatim into `mcp-browser/`**

`mcp-browser/build-argv.js` is a byte-for-byte copy of `mcp/build-argv.js` (read that file for the exact contents — it's fully generic, no `hc`-specific code). Each MCP server folder stays self-contained and independently installable/removable from `natsu-settings`, so this is a deliberate small duplication, not an import across the two folders.

- [ ] **Step 2: Write `mcp-browser/build-argv.test.js`**

Port `mcp/build-argv.test.js`'s five test cases verbatim (same `buildArgv` contract, so the same assertions apply) but reword the example `def.cmd` values to agent-browser shapes instead of hc's, so the test file reads naturally for this package — e.g. the bool test uses `cmd: ["snapshot"], args: [{field: "interactive", flag: "--interactive", kind: "bool"}]` instead of `ls`/`--all`, and the "matches a real tool's shape" test mirrors `browser_click`'s eventual shape: `cmd: ["click"], args: [{field: "new_tab", flag: "--new-tab", kind: "bool"}, {field: "session", flag: "--session", kind: "value"}, {field: "selector", kind: "positional"}]`, asserting `buildArgv(def, {selector: "#btn"})` → `["click", "#btn"]` and with `new_tab: true, session: "s1"` → `["click", "--new-tab", "--session", "s1", "#btn"]`.

- [ ] **Step 3: Run the test and verify it passes**

Run: `node --test mcp-browser/build-argv.test.js`
Expected: all 5 tests pass (no implementation to fix — `buildArgv` is a verbatim copy of already-working code).

- [ ] **Step 4: Write `mcp-browser/agent-browser.js`**

```js
import { execFile } from "node:child_process";

export function runAgentBrowser(args, { bin = "agent-browser" } = {}) {
  return new Promise((resolve) => {
    execFile(bin, [...args, "--json"], { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && err.code === "ENOENT") {
        resolve({ code: null, stdout: "", stderr: `${bin} not found on PATH` });
        return;
      }
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr });
    });
  });
}

export function toToolContent(result) {
  // identical body to mcp/hc.js's toToolContent — copy it verbatim.
}
```

Copy `toToolContent`'s body from `mcp/hc.js` unchanged (it's generic: parses `result.stdout` as JSON, falls back to raw text, and shapes a `{code === null || code !== 0}` result as `isError: true`). `runAgentBrowser` differs from `mcp/hc.js`'s `runHc` only in: default `bin` is `"agent-browser"` not `"hc"`; `--json` is appended after the args instead of prepended before the subcommand (per `agent-browser --help`, `--json` is documented as a per-subcommand "Global Option" used like `agent-browser screenshot --annotate --json`, not a flag before the subcommand the way `hc --json <subcommand>` is); and there's no `runAgentBrowserTimed`/`stdin` support (no kept `agent-browser` command needs either — unlike `hc run`/`hc file write`).

- [ ] **Step 5: Manual smoke test, including the missing-binary case**

Run: `node -e "import('./mcp-browser/agent-browser.js').then(m => m.runAgentBrowser(['get', 'title']).then(r => console.log(r)))"` from the `mcp-browser/` directory (or with a relative path adjusted).
Expected: `{ code: 0 or non-null, stdout: ..., stderr: ... }` — if no browser session is open yet, a nonzero `code` with an error message in `stdout`/`stderr` is fine; the point is the promise resolves (doesn't hang) and doesn't throw.

Then (Review Focus: agent-browser missing from PATH), run the same with a nonexistent binary: `node -e "import('./mcp-browser/agent-browser.js').then(m => m.runAgentBrowser(['get','title'], {bin: 'definitely-not-a-real-binary'}).then(r => console.log(r)))"`.
Expected: resolves (does not throw/hang) with `{ code: null, stdout: "", stderr: "definitely-not-a-real-binary not found on PATH" }`.

- [ ] **Step 5b: Add `mcp-browser/node_modules/` to `.gitignore`**

Append `mcp-browser/node_modules/` to the repo root `.gitignore`, alongside the existing `mcp/node_modules/` entry.

- [ ] **Step 6: Write `mcp-browser/package.json`**

```json
{
  "name": "natsu-browser-mcp",
  "private": true,
  "type": "module",
  "version": "0.1.0",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.32.2",
    "zod": "^4.6.7"
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add mcp-browser/package.json mcp-browser/build-argv.js mcp-browser/build-argv.test.js mcp-browser/agent-browser.js .gitignore
git commit -m "Add mcp-browser argv builder and agent-browser exec helper"
```

---

## Task 2: `mcp-browser` — tool table + MCP server

**Files:**
- Create: `mcp-browser/tools.js`
- Create: `mcp-browser/server.js`

**Interfaces:**
- Consumes: `buildArgv` from `./build-argv.js` (Task 1), `runAgentBrowser`/`toToolContent` from `./agent-browser.js` (Task 1).
- Produces: `server.js` exports `createServer(): McpServer` (named export, mirrors `mcp/server.js`) and, when run directly (`node mcp-browser/server.js`), connects it over stdio — this is what `natsu-settings`'s Browser section (Task 4) registers with `claude mcp add`.

- [ ] **Step 1: Write `mcp-browser/tools.js`**

One `TOOLS` array entry per kept command, each `{ name, cmd, description, schema, args }` (same shape as `mcp/tools.js`). Every tool's `schema`/`args` includes a `session: z.string().optional()` field mapped to `--session` (`kind: "value"`) — `agent-browser`'s own `--session <name>` is a Global Option on every subcommand (confirmed via `agent-browser <command> --help` for all commands below). Exact entries:

| name | cmd | schema fields (all but `selector`/`text`/`key` optional) | args (in order) |
|---|---|---|---|
| `browser_open` | `["open"]` | `url?: string, headed?: boolean, headers?: string, session?: string` | `headed→--headed bool, headers→--headers value, session→--session value, url→positional` |
| `browser_click` | `["click"]` | `selector: string, new_tab?: boolean, session?: string` | `new_tab→--new-tab bool, session→--session value, selector→positional` |
| `browser_dblclick` | `["dblclick"]` | `selector: string, session?: string` | `session→--session value, selector→positional` |
| `browser_type` | `["type"]` | `selector: string, text: string, session?: string` | `session→--session value, selector→positional, text→positional` |
| `browser_fill` | `["fill"]` | `selector: string, text: string, session?: string` | same shape as `browser_type` |
| `browser_press` | `["press"]` | `key: string, session?: string` | `session→--session value, key→positional` |
| `browser_screenshot` | `["screenshot"]` | `selector?: string, path?: string, full?: boolean, annotate?: boolean, format?: "png"|"jpeg", quality?: number, session?: string` | `full→--full bool, annotate→--annotate bool, format→--screenshot-format value, quality→--screenshot-quality value, session→--session value, selector→positional, path→positional` |
| `browser_snapshot` | `["snapshot"]` | `interactive?: boolean, urls?: boolean, compact?: boolean, depth?: number, selector?: string, session?: string` | `interactive→--interactive bool, urls→--urls bool, compact→--compact bool, depth→--depth value, selector→--selector value, session→--session value` |
| `browser_scroll` | `["scroll"]` | `direction?: "up"|"down"|"left"|"right", amount?: number, selector?: string, session?: string` | `selector→--selector value, session→--session value, direction→positional, amount→positional` |
| `browser_wait` | `["wait"]` | `target?: string, url?: string, load?: "load"|"domcontentloaded"|"networkidle", fn?: string, text?: string, download?: string, timeout?: number, session?: string` | `url→--url value, load→--load value, fn→--fn value, text→--text value, download→--download value, timeout→--timeout value, session→--session value, target→positional` |
| `browser_back` | `["back"]` | `session?: string` | `session→--session value` |
| `browser_forward` | `["forward"]` | `session?: string` | `session→--session value` |
| `browser_reload` | `["reload"]` | `session?: string` | `session→--session value` |
| `browser_close` | `["close"]` | `all?: boolean, session?: string` | `all→--all bool, session→--session value` |

Two tools can't fit the generic `buildArgv` shape and are marked `special: true` (handled directly in `server.js`, same pattern `mcp/server.js` already uses for `hc_exec`/`hc_file_write`/`hc_events`):

- `browser_get` — schema `{ subcommand: z.enum(["text","html","value","attr","title","url","count","box","styles","cdp-url"]), selector?: string, attr_name?: string, session?: string }`, description from `agent-browser get --help`'s subcommand list.
- `agent_browser_exec` — schema `{ args: z.array(z.string()) }`, description: "Run any agent-browser subcommand not covered by the other tools (mouse, network, storage, tabs, diff, debug/trace, streaming, react, performance, SPA, cookies, clipboard); pass the full argv after `agent-browser`, e.g. `[\"network\",\"route\",\"*\",\"--abort\"]`."

- [ ] **Step 2: Write `mcp-browser/server.js`**

Mirror `mcp/server.js`'s shape exactly:

```js
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
```

- [ ] **Step 3: `npm install` and verify the server starts**

Run: `cd mcp-browser && npm install`
Expected: installs `@modelcontextprotocol/sdk` and `zod` cleanly (no peer-dep errors).

Run: `node mcp-browser/server.js` then send it an MCP `initialize` request on stdin (or: `echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node mcp-browser/server.js`)
Expected: a `tools/list` JSON-RPC response listing all 16 tool names from the table above (14 generic + `browser_get` + `agent_browser_exec`), process doesn't crash or hang.

Then (Review Focus: `browser_get` with a subcommand `agent-browser` rejects), call `browser_get` with `{ subcommand: "count" }` and no `selector` (agent-browser's `get count` requires a selector argument, so this should fail at the CLI level).
Expected: the tool call still returns a normal MCP tool result — `toToolContent`'s `isError: true` shape (JSON text containing `error: true`, a nonzero `code`, and `stderr`) — not an uncaught exception that kills the server process or a protocol-level error instead of a tool-level one.

- [ ] **Step 4: Commit**

```bash
git add mcp-browser/tools.js mcp-browser/server.js mcp-browser/package-lock.json
git commit -m "Add mcp-browser tool table and MCP server"
```

---

## Task 3: `natsu-settings` — generalize to a section-array model (behavior-preserving)

**Files:**
- Modify: `mods/natsu-settings/main.js` (full rewrite of the `NatsuSettings` class body; current file read in full for this plan — see the file for exact current line numbers)

**Interfaces:**
- Consumes: nothing new (still just `gpui-kit`/`gpui-base`/`herdr`/`fs/promises`).
- Produces: a `SECTIONS` array (module-level, created in Task 4/5 by *adding entries* to the array this task defines with one entry) where each section is:
  ```ts
  {
    id: string,            // e.g. "mcp"
    label: string,          // nav row text, e.g. "MCP"
    icon: string,            // workspace-chrome icon name, e.g. "server"
    title: string,           // header title, e.g. "MCP server"
    subtitle: string,        // header subtitle line
    serverName: string,      // claude mcp server name to check/add/remove, e.g. "natsu-hc"
    checks: Array<{ key: string, label: string, bin: string, args: string[] }>, // PATH/version probes
    depsCheck: { label: string, path: string } | null, // relative-to-home file probe, or null if nothing to npm-install
    prepCmd: { bin: string, args: string[], opts?: object } | null, // run before `claude mcp add`; null = nothing to run
    skipPrepWhenDepsReady: boolean, // true: skip prepCmd if depsCheck's probe already passed (mcp/browser); false: always run it (computer-use's installer is self-idempotent)
    mcpAddArgs: string[],    // argv after `claude mcp add -s user <serverName>`, e.g. ["--", "node", `${MCP_DIR}/server.js`]
    pathLabel: string,       // shown in the "Server path" box; NOT derived from mcpAddArgs — its last element isn't always a path (computer-use's is the literal subcommand "mcp"), so this is its own explicit field
  }
  ```
  `SECTIONS` is a **module-level, pure-data** constant (no functions, so no `this`-closure question) — every section, including `mcp`, is expressed entirely in this shape; the class's `install(cx, sectionId)` method (Step 3) is the one place that interprets `prepCmd`/`skipPrepWhenDepsReady` and owns all `this` mutation. This task defines that engine and rewrites the `mcp` entry (today's `natsu-hc` section, currently a one-off `npm install` call inside `install()`) into this data shape, with identical rendered output and behavior to the current file. Tasks 4 and 5 each add one more `SECTIONS` entry — pure data, no engine changes.

- [ ] **Step 1: Generalize state from single-section to per-section-keyed**

Replace `this.busy`, `this.lastError`, `this.status` (flat) with per-section objects keyed by section `id`:
```js
this.busy = {};       // { [sectionId]: boolean }
this.lastError = {};  // { [sectionId]: string | null }
this.status = {};     // { [sectionId]: { [checkKey]: boolean | null, registered: boolean | null } }
```
`init(_props, cx)` replaces its single `this.refresh(cx)` call with `for (const s of SECTIONS) this.refresh(cx, s.id);` — one call per section id, not one call for a hardcoded `"mcp"`.

- [ ] **Step 2: Generalize `refresh(cx, sectionId)`**

Look up `const section = SECTIONS.find(s => s.id === sectionId)`. Build the `step()`-isolated `Promise.all` from `section.checks` (one `withTimeout(safeExec(c.bin, c.args), CHECK_TIMEOUT_MS, cx)` per check, keyed by `c.key`) plus `isRegistered(section.serverName)` plus, if `section.depsCheck` is non-null, the existing `fs.readFile(section.depsCheck.path, "utf8")` probe (if `depsCheck` is null, that status key is simply omitted/always `true` — depsReady only gates the install flow, see Step 3). Write results into `this.status[sectionId]`, `lastError` into `this.lastError[sectionId]`, same per-step isolation as the current file. `isRegistered` becomes `async function isRegistered(serverName)` (parameterize away the hardcoded `MCP_NAME` module constant — it becomes `section.serverName` at call sites; the `mcp` section's `serverName` is still the string `"natsu-hc"`).

- [ ] **Step 3: Generalize `install(cx, sectionId)` / `remove(cx, sectionId)`**

```js
install(cx, sectionId) {
  const section = SECTIONS.find(s => s.id === sectionId);
  if (this.busy[sectionId]) return;
  this.busy[sectionId] = true;
  this.lastError[sectionId] = null;
  cx.notify();
  cx.spawn(async (cx) => {
    const needsPrep = section.prepCmd && (!section.skipPrepWhenDepsReady || !this.status[sectionId]?.depsReady);
    if (needsPrep) {
      const prep = await safeExec(section.prepCmd.bin, section.prepCmd.args, section.prepCmd.opts);
      if (prep.code !== 0) {
        this.lastError[sectionId] = prep.stderr || "install step failed";
        this.busy[sectionId] = false;
        cx.notify();
        return;
      }
    }
    const add = await safeExec("claude", ["mcp", "add", "-s", "user", section.serverName, ...section.mcpAddArgs]);
    if (add.code !== 0 && !/already exists/i.test(add.stderr)) this.lastError[sectionId] = add.stderr || "claude mcp add failed";
    this.refresh(cx, sectionId);
    this.busy[sectionId] = false;
    cx.notify();
  });
}
```
`remove(cx, sectionId)` mirrors today's `remove()` but keyed the same way, running `claude mcp remove -s user ${section.serverName}`.

For the `mcp` section specifically: `prepCmd: { bin: npmBin(), args: ["install"], opts: { cwd: MCP_DIR } }`, `skipPrepWhenDepsReady: true` — this is today's existing `npm install` step, expressed as data instead of a one-off call inside `install()`. `npmBin()` is still evaluated once (it reads `appWindow()?.platform`, not a per-render value) wherever `SECTIONS` is constructed.

- [ ] **Step 4: Generalize rendering**

`statusRow`/`statusPill`/`button` stay as-is (already take `t` + explicit values, no section coupling). `mcpSection(t)` becomes a generic `sectionBody(t, section)` reading `this.status[section.id]`, `this.lastError[section.id]`, `this.busy[section.id]` instead of the flat fields, iterating `section.checks` for the status rows instead of the four hardcoded `statusRow(...)` calls. `render(cx)`'s `sections` array becomes the module-level `SECTIONS` array (now driving both the nav list and, via `this.active`, which section's body shows) instead of the hardcoded one-entry array.

- [ ] **Step 5: Verify no behavior change**

Run: `node --check mods/natsu-settings/main.js` then `herdr-app check "C:/Users/Natsu/.config/herdr-app/mods/natsu-settings"`
Expected: both pass.

Manual, in the running app (same technique used earlier this session — `herdr-app do layout.select --stack panel-body --child settings`, `herdr-app do layout.show --id panel`, then `herdr-app shot`): confirm the `mcp` section renders identically to before this task (same title, same 4 checklist rows, same pill, same Install/Remove button) and that Install/Remove still work against `natsu-hc`.

This task's `SECTIONS` array has only the one `mcp` entry, so per-section state isolation (Review Focus item 5) can't be fully exercised yet — re-run this check after Task 5 adds a second section: click Install on `browser` and, while its `busy` state is still showing (button reads "Please wait…"), switch the nav to `mcp` and confirm its button is still clickable and its own `lastError`/status are unaffected.

- [ ] **Step 6: Commit**

```bash
git add mods/natsu-settings/main.js
git commit -m "Generalize natsu-settings to a section-array model (behavior-preserving)"
```

---

## Task 4: `natsu-settings` — "Computer Use" section (cua-driver)

**Files:**
- Modify: `mods/natsu-settings/main.js` (add one pure-data `SECTIONS` entry; no engine changes)

**Interfaces:**
- Consumes: the section shape and engine from Task 3.
- Produces: nothing new consumed by later tasks (Task 5 is independent; Task 7 just confirms this section renders).

- [ ] **Step 1: Add the `computer-use` section entry**

```js
{
  id: "computer-use", label: "Computer Use", icon: "terminal",
  title: "Computer Use",
  subtitle: "cua-driver — native desktop control (clicks, typing, window state) via Windows UIA",
  serverName: "cua-driver",
  checks: [{ key: "cuaDriver", label: "cua-driver on PATH", bin: "cua-driver", args: ["--version"] }],
  depsCheck: null,
  prepCmd: { bin: "powershell", args: ["-NoProfile", "-Command", "irm https://cua.ai/driver/install.ps1 | iex"] },
  skipPrepWhenDepsReady: false, // installer is self-idempotent (upgrades/no-ops if current); always run it on Install
  mcpAddArgs: ["--transport", "stdio", "--", "cua-driver", "mcp"],
  pathLabel: "cua-driver mcp", // not a file path (no local server.js here) — the actual registered command
}
```
Pure data — the shared `install(cx, sectionId)` engine from Task 3 Step 3 interprets `prepCmd`/`skipPrepWhenDepsReady` for every section, including this one; no section-specific code is added here.

Checks render one row: "cua-driver on PATH". `claude --version`/"Claude Code CLI on PATH" is deliberately **not** repeated here — only the `mcp` section's `claude` check continues to exist system-wide; see Review Focus item 2's scope note: each section's own install/registration flow doesn't depend on re-displaying a prereq that's already visible on another nav row.

- [ ] **Step 2: Verify**

Run: `node --check mods/natsu-settings/main.js` then `herdr-app check "C:/Users/Natsu/.config/herdr-app/mods/natsu-settings"`.
Expected: both pass.

Manual: open the Settings panel, click the new "Computer Use" nav row, confirm it renders "cua-driver on PATH" (red/unknown until `cua-driver` is actually installed) and an Install button. Click Install; confirm `cua-driver --version` succeeds afterward from a plain terminal and `claude mcp list` (run manually, not through the UI) shows `cua-driver`. Click Remove; confirm it's gone from `claude mcp list` (the binary itself stays installed — Remove only un-registers it, per the spec's scope boundary).

- [ ] **Step 3: Commit**

```bash
git add mods/natsu-settings/main.js
git commit -m "Add Computer Use (cua-driver) section to natsu-settings"
```

---

## Task 5: `natsu-settings` — "Browser" section (natsu-browser / agent-browser)

**Files:**
- Modify: `mods/natsu-settings/main.js` (add one pure-data `SECTIONS` entry)

**Interfaces:**
- Consumes: the section shape/engine from Task 3; `mcp-browser/server.js` from Task 2 (referenced by path in `mcpAddArgs`, not imported).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the `browser` section entry**

```js
const BROWSER_REPO_REL = "mods/herdr-natsu/mcp-browser";
const BROWSER_DIR = `${home()}/.config/herdr-app/${BROWSER_REPO_REL}`;

{
  id: "browser", label: "Browser", icon: "monitor",
  title: "Browser automation",
  subtitle: "natsu-browser — agent-browser's core commands as MCP tools",
  serverName: "natsu-browser",
  // Same PATHEXT gap as npmBin() above: herdr's exec() spawns directly, no
  // .cmd/.exe resolution, and agent-browser ships as an npm .cmd shim on
  // Windows (confirmed via `where agent-browser`) — a bare "agent-browser"
  // ENOENTs here even though it's genuinely on PATH.
  checks: [{ key: "agentBrowser", label: "agent-browser on PATH", bin: appWindow()?.platform === "windows" ? "agent-browser.cmd" : "agent-browser", args: ["--version"] }],
  depsCheck: { label: "Server dependencies installed", path: `.config/herdr-app/${BROWSER_REPO_REL}/node_modules/zod/package.json` },
  prepCmd: { bin: npmBin(), args: ["install"], opts: { cwd: BROWSER_DIR } },
  skipPrepWhenDepsReady: true,
  mcpAddArgs: ["--", "node", `${BROWSER_DIR}/server.js`],
  pathLabel: `${BROWSER_DIR}/server.js`,
}
```
Pure data, same shape as Task 4's entry — no section-specific code.

If `agent-browser` isn't on PATH, the section shows that (the existing "no auto-install of Node.js" boundary extends here: `natsu-settings` never runs `npm install -g agent-browser` on the person's behalf — the check just says it's missing and the Install button is withheld, matching how the `mcp` section already behaves when `node` itself is missing).

- [ ] **Step 2: Verify**

Run: `node --check mods/natsu-settings/main.js` then `herdr-app check "C:/Users/Natsu/.config/herdr-app/mods/natsu-settings"`.
Expected: both pass.

Manual: open Settings → "Browser" nav row. Since `agent-browser` is already on PATH on this machine, its check should show green immediately. Click Install; confirm `mcp-browser/node_modules` gets created (npm install ran) and `claude mcp list` shows `natsu-browser` afterward. From a Claude Code session with it registered, call `browser_open` with a URL and confirm it works (real browser window opens, `agent-browser get title` from a plain terminal confirms the page loaded).

- [ ] **Step 3: Commit**

```bash
git add mods/natsu-settings/main.js
git commit -m "Add Browser (agent-browser) section to natsu-settings"
```

---

## Task 6: `natsu-tabs` — fourth panel button ("Browser")

**Files:**
- Modify: `mods/natsu-tabs/main.js:83` (the `enabled` array) and `:100-102` (the `panelButton(...)` chain)

**Interfaces:**
- Consumes: nothing new.
- Produces: a `panel-${id}` click target with `id = "browser-view"` that Task 7's layout change (`panel-body`'s `browser-view` child) must match exactly.

- [ ] **Step 1: Add `"browser-view"` to the always-included panel list**

Change line 83 from:
```js
const enabled = [...(shared("workspace.panels") ?? ["files", "changes"]), "settings"];
```
to:
```js
const enabled = [...(shared("workspace.panels") ?? ["files", "changes"]), "settings", "browser-view"];
```
(Same reasoning already documented in the comment immediately above that line for `"settings"`: this fork's own panels aren't gated behind the shared `workspace.panels` setting.)

- [ ] **Step 2: Add the fourth `panelButton`**

After line 102 (`.when(enabled.includes("settings"), ...)`), add:
```js
.when(enabled.includes("browser-view"), el => el.child(panelButton("browser-view", "Browser", "mods/workspace-chrome/monitor.svg")))
```

- [ ] **Step 3: Verify**

Run: `node --check mods/natsu-tabs/main.js` then `herdr-app check "C:/Users/Natsu/.config/herdr-app/mods/natsu-tabs"`.
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add mods/natsu-tabs/main.js
git commit -m "Add fourth panel tab button (Browser) to natsu-tabs"
```

---

## Task 7: `natsu-browser-view` — live screenshot pane + layout wiring + end-to-end verification

**Files:**
- Create: `mods/natsu-browser-view/mod.json`
- Create: `mods/natsu-browser-view/main.js`
- Modify: `layouts/natsu.json` (add a `browser-view` child to the existing `panel-body` stack, alongside `files`/`changes`/`settings`)

**Interfaces:**
- Consumes: `panelButton("browser-view", ...)` from Task 6 (the id must match); `agent-browser` CLI (already on PATH; no Task 1/2 code is imported — this pane shells out directly, independent of the MCP server).
- Produces: nothing consumed by later tasks (last task in the plan).

- [ ] **Step 1: Write `mods/natsu-browser-view/mod.json`, and gitignore the generated screenshot**

```json
{ "place": "none", "title": "Browser" }
```

Append `mods/natsu-browser-view/live.png` to the repo root `.gitignore` (it's a generated runtime artifact, same reasoning as the existing `herdr-shot.png` entry).

- [ ] **Step 2: Write `mods/natsu-browser-view/main.js`**

```js
import { View, div, image } from "gpui-kit";
import { v_flex } from "gpui-base";
import { exec, home, theme, window as appWindow } from "herdr";

const POLL_MS = 2500;
const SHOT_REL = "mods/natsu-browser-view/live.png"; // no subfolder: fs/promises here only confirms readFile/writeFile work (Global Constraints), not mkdir — write directly where the mod's own files already live, no new directory needed
// Same PATHEXT gap as natsu-settings' npmBin()/the Browser section's check:
// herdr's exec() spawns directly, and agent-browser ships as an npm .cmd
// shim on Windows — a bare "agent-browser" ENOENTs even though it's on PATH.
const AGENT_BROWSER_BIN = appWindow()?.platform === "windows" ? "agent-browser.cmd" : "agent-browser";

export default class NatsuBrowserView extends View {
  init(_props, cx) {
    this.hasShot = false;
    this.lastOk = false;
    this.refresh(cx);
    this.timer = cx.timer.every(POLL_MS, (cx) => this.refresh(cx));
  }

  close() {
    if (this.timer && !this.timer.is_done()) this.timer.cancel();
  }

  refresh(cx) {
    cx.spawn(async (cx) => {
      const path = `${home()}/.config/herdr-app/${SHOT_REL}`;
      const r = await exec(AGENT_BROWSER_BIN, ["screenshot", path]).catch((err) => ({ code: null, stderr: String(err?.message ?? err) }));
      this.hasShot = true;
      this.lastOk = r.code === 0;
      cx.notify();
    });
  }

  render() {
    const t = theme();
    return v_flex().id("browser-view-root").size_full().bg(t.background).items_center().justify_center().p(16)
      .when(!this.hasShot || !this.lastOk, (el) => el.child(div().text_color(t.dim).text_size(13).child("No browser session yet")))
      .when(this.hasShot && this.lastOk, (el) => el.child(image(SHOT_REL).max_w_full().max_h_full()));
  }
}
```

One open question this step resolves empirically rather than guessing: whether GPUI's `image()` loader caches by path and needs a cache-busting trick to show a file overwritten in place every poll (flagged in the spec's "Open implementation details"). If Step 4's manual check shows the image going stale (first screenshot shown forever, later polls not reflected), change `SHOT_REL`/`path` to alternate between two filenames (`live-a.png`/`live-b.png`) each poll and render whichever was just written.

- [ ] **Step 3: Wire into the layout**

In `layouts/natsu.json`, inside the existing `panel-body` stack's `children` array (alongside the `files`/`changes`/`settings` blocks), add:
```json
{ "id": "browser-view", "type": "block", "content": { "mod": "natsu-browser-view" } }
```

- [ ] **Step 4: Create the symlink and verify everything**

```bash
cmd //c mklink /D "C:\Users\Natsu\.config\herdr-app\mods\natsu-browser-view" "C:\Users\Natsu\.config\herdr-app\mods\herdr-natsu\mods\natsu-browser-view"
```
(Use a real symlink via `mklink /D`, not a junction — matches this session's established fix; Developer Mode is confirmed on for this machine.)

Run `herdr-app check` on every touched/new mod:
```bash
for m in natsu-tabs natsu-settings natsu-browser-view; do herdr-app check "C:/Users/Natsu/.config/herdr-app/mods/$m"; done
```
Expected: all three pass.

Restart Herdr (kill `herdr-app.exe`, relaunch it — layout JSON and new mod folders need a cold load, same as earlier this session), then, using the `herdr-app do layout.select`/`layout.show`/`herdr-app shot` technique already established this session:
1. Confirm all three `natsu-settings` nav rows (MCP, Computer Use, Browser) render.
2. Confirm the fourth tab button "Browser" appears next to Files/Changes/Settings and toggles the new pane.
3. Review Focus — idle state: with no browser session open (run `agent-browser close --all` first if an earlier task's testing left one open), open the Browser pane and confirm it shows "No browser session yet", not a crash or a broken-image box.
4. From any Herdr terminal, run `agent-browser open example.com`, then confirm the Browser pane shows a real screenshot within one poll interval (~2.5s) instead of the placeholder.
5. Restore `panel`/`panel-body` to hidden/`files` afterward (same courtesy cleanup done earlier this session). `mods/natsu-browser-view/live.png` itself is gitignored (Step 1) and can stay on disk.

- [ ] **Step 5: Commit**

```bash
git add mods/natsu-browser-view/mod.json mods/natsu-browser-view/main.js layouts/natsu.json .gitignore
git commit -m "Add natsu-browser-view live screenshot pane and wire it into the natsu layout"
```
