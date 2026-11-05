# MCP terminal bridge + Settings page — design

Date: 2026-11-05

## Purpose

Today, an agent (e.g. Claude Code) running inside a Herdr terminal can see
and operate terminals belonging to *other* agents — including on other
machines — only if it has shell access and calls `hc` itself. Nothing
tells it those terminals or machines exist unless it's told, or it runs
`hc ls` / `hc machine ls` on its own initiative.

This adds:

1. **`natsu-hc`**, a local MCP server that exposes `hc`'s terminal
   commands as MCP tools, 1:1, full access (no permission scoping — any
   connected agent can read/send to any terminal `hc` can reach,
   including other machines via `hc`'s own machine pairing). Useful both
   to agents that have no shell at all, and to agents that do but want a
   structured, schema-checked way to call `hc` instead of composing CLI
   strings by hand.
2. **`natsu-settings`**, a mod pane (opened from the tab bar next to
   Files/Changes) with a left section list and a right content panel,
   whose first (and for now only) section shows `natsu-hc`'s install
   status and a button to register/unregister it with Claude Code.

Terminal A keeps running and receiving input normally while terminal B
(via its agent, via the MCP server) reads or sends to it — `hc send`
pastes text into A, it doesn't take A over exclusively, so this requires
no new "sharing" mechanism beyond what `hc` already does.

## Scope boundaries (explicitly out)

- No permission/allowlist system. Full access is the point.
- No tools for `attach`, `connect`, `server start/stop/status/restart`,
  `update`, `schema` — these act on *the calling terminal itself* or on
  core/binary lifecycle, not on "see/operate another terminal", so they
  don't fit an MCP tool call from a process with no terminal of its own.
  `events` (an infinite stream) becomes a poll-once tool instead of a
  held-open subscription.
- Registration is local-only: the Settings page manages the Claude Code
  MCP registration on *this* machine (the one running Herdr). It does not
  reach into other paired machines to install anything there. If someone
  wants the same bridge on another machine, they open Herdr there (or run
  the same install command there) separately.
- Only Claude Code is wired up as the registering client (`claude mcp
  add`/`remove`). Other MCP clients (Claude Desktop, etc.) aren't handled
  by the install button; nothing stops a person from configuring them
  manually, pointing at the same `mcp/server.js`.
- No auto-install of Node.js itself. If `node` isn't found, the Settings
  section says so and stops.

## Architecture

### `mcp/` — the MCP server (new folder in this repo)

- `mcp/package.json` — `"type": "module"`, dependency
  `@modelcontextprotocol/sdk`.
- `mcp/server.js` — stdio MCP server (`StdioServerTransport`). One tool
  per included `hc` subcommand (see Tool mapping). Every handler:
  1. Builds `argv` from the tool's input fields, mirroring that
     subcommand's own flags (see below).
  2. Always appends `--json` (hc defaults to text for `run`/`read`
     outside a pipe; forcing `--json` keeps every tool's output
     machine-parseable).
  3. Runs `hc` via Node's `child_process.execFile` (no shell
     interpolation — args passed as an array, never concatenated into a
     string, since the input ultimately comes from an LLM-controlled
     agent and must not be treated as shell syntax).
  4. On a clean run, parses stdout as JSON and returns it. If parsing
     fails, returns the raw stdout text instead of throwing (hc's JSON
     contract isn't guaranteed for every subcommand/edge case).
  5. On nonzero exit, returns an object `{ error: true, code, stdout,
     stderr }` as the tool's content instead of throwing — the calling
     agent sees exactly what `hc` said, same shape `herdr`'s own `exec()`
     already uses elsewhere in this repo's mods.
  6. If `hc` itself isn't found on PATH, every call returns a clear
     `{ error: "hc not found on PATH" }` rather than a Node ENOENT stack.

No server-side state beyond what `hc` itself tracks; the server is a
pure translation layer.

### Tool mapping

One tool per kept subcommand, named `hc_<subcommand>` (`hc_ls`, `hc_run`,
`hc_send`, `hc_machine_ls`, ...). Each tool's input schema mirrors that
subcommand's *own* `--help` flags one-to-one (same flag names become
JSON properties) — the exact field list is pinned down per-command while
implementing (run `hc <command> --help` and transcribe), not guessed
here, so the schema can't drift from the real CLI.

Kept subcommands: `run`, `ls`, `get`, `read`, `kill`, `rm`, `label`,
`keep`, `send`, `keys`, `interrupt`, `wait`, `put`, `exec`, `file read`,
`file write`, `file edit`, `templates`, `events` (as a poll-once:
"events since <cursor/timestamp>", not a held-open stream), `machine
ls`, `machine add`, `machine login`, `machine update`, `machine rename`,
`machine rm`.

Watch-out: `machine add` / `machine login` may expect an interactive
terminal (e.g. an SSH password prompt) that a non-interactive `exec` can't
satisfy. Test each during implementation; if a subcommand can't complete
non-interactively, say so in that tool's description rather than silently
hanging or failing opaquely.

`cwd`/`on` fields, where the underlying command supports them, are
passed straight through — this is exactly how `hc` already reaches other
machines (its own ssh-based pairing), so the MCP server needs no network
code of its own for multi-machine access.

### `natsu-settings` mod

New mod, docked nowhere by itself (`mod.json`: `"place": "none"`) —
it only ever shows inside the `panel-body` stack, like `files`/`changes`.

Render: one pane, split internally (not via layout JSON — one mod block,
like Files/Changes) into two `h_flex` children by flex weight 2:8:

- Left (weight 2): a plain list of sections, each `{ id, label, render }`
  in a hardcoded array. Today: one entry, `{ id: "mcp", label: "MCP",
  render: this.mcpSection }`. Adding a future section later is adding one
  array entry — no plugin/registration system, since nothing today needs
  one.
- Right (weight 8): calls the selected section's `render`.

`mcpSection` renders:
- A status dot + text: whether `natsu-hc` is registered with Claude Code
  right now. Detected by running `exec("claude", ["mcp", "list"])` and
  checking whether its output names the server (e.g. `natsu-hc`).
- Whether `mcp/node_modules` exists (dependencies installed) and whether
  `node` is on PATH (`exec("node", ["--version"])`); if `node` is
  missing, show that and skip further detail — nothing else can proceed.
- The server's path, shown for reference (what the Install button will
  register).
- **Install** button (shown when not registered): if `node_modules` is
  missing, first `exec("npm", ["install"], { cwd: "<repo>/mcp" })`; then
  `exec("claude", ["mcp", "add", "--scope", "user", "natsu-hc", "--",
  "node", "<repo>/mcp/server.js"])`. Re-check status after either step
  and show its stderr inline if it fails, rather than failing silently.
- **Remove** button (shown when registered): `exec("claude", ["mcp",
  "remove", "natsu-hc"])`, then re-check status.

### Wiring into the layout (this repo's `natsu` layout)

1. `mod.clone({ name: "tabs", as: "natsu-tabs" })`, then hand-edit the
   clone: add a third `panelButton("settings", "Settings",
   "mods/natsu-settings/<icon>.svg")` next to the existing Files/Changes
   buttons, gated the same way (`enabled.includes("settings")` against
   `shared("workspace.panels")`, defaulting that array to include
   `"settings"` too so it shows without extra setup).
2. `layouts/natsu.json`: change the `tabs` block's `content.mod` from
   `"tabs"` to `"natsu-tabs"`; add a `settings` child (`content.mod:
   "natsu-settings"`) to the existing `panel-body` stack alongside
   `files`/`changes`.

This reuses the exact same per-space "which panel is open" memory
Files/Changes already have (`natsu-tabs`'s `syncPanel`, copied from
`tabs`). That's slightly imprecise for a page that's really global
settings, not per-space — but it's the mechanism asked for (same bar,
same behavior as Files/Changes), and not worth a second mechanism for
one page.

## Data flow (for the MCP tools)

Agent B (MCP client, e.g. Claude Code in terminal B) → stdio → `natsu-hc`
Node process → `execFile("hc", [...args, "--json"])` → herdr-core → the
target terminal (A — possibly on another machine, reached through `hc`'s
own existing machine pairing) → result JSON returned up the same path to
agent B. Terminal A's own program keeps running throughout; `hc send`
only pastes text and presses enter, it never locks A away from its own
user or agent.

## Error handling summary

- `hc` missing → clear tool-level error, no stack trace.
- Nonzero exit from `hc` → structured `{error, code, stdout, stderr}`,
  never thrown.
- Non-JSON stdout despite `--json` → raw text returned, not a crash.
- Settings mod: every `exec()` (claude, npm, node --version) checked for
  failure and shown inline; no step is assumed to succeed silently.

## Testing / verification

- `herdr-app check` on both `natsu-tabs` and `natsu-settings` after
  writing them.
- Manual, in the running app: toggle the new Settings button the same
  way Files/Changes already toggle; confirm the MCP section's status
  reflects reality before and after clicking Install (check with `claude
  mcp list` from a plain terminal too); click Remove and confirm it
  disappears from `claude mcp list`.
- End-to-end: with two terminals A and B open (B running an MCP-capable
  agent with `natsu-hc` registered), call the `hc_send` tool from B
  targeting A's address, and confirm the text lands in A while A keeps
  running normally. Call `hc_ls` and confirm it lists terminals across
  every machine `hc machine ls` already knows about, not just local
  ones.

## Open implementation details (deliberately left for the plan/build step)

- Exact flags per tool: pinned by reading each `hc <command> --help`
  while building that tool, not guessed in this spec.
- The `events` poll-once tool's exact parameter for "since" (cursor vs.
  timestamp) depends on what `hc events --help` actually offers.
