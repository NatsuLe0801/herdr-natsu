# Browser + computer-use automation: cua-driver, agent-browser MCP bridge, live-view panel — design

Date: 2026-11-05

## Purpose

Today, an agent (e.g. Claude Code) running inside a Herdr terminal can
already call `agent-browser` directly via shell — it's a CLI on PATH — but
has no structured, schema-checked tool surface for it, and the person at
the keyboard has no way to watch what it's doing short of reading raw
terminal text or manually running `agent-browser screenshot`.
`cua-driver` (trycua/cua's broader desktop-automation driver — not just
the browser, native app control via Windows UIA) isn't installed at all.

This adds three pieces, following the exact pattern `natsu-hc` /
`natsu-settings` already established (see
`2026-11-05-mcp-terminal-bridge-settings-design.md`):

1. **`cua-driver`** installed and registered as an MCP server. Unlike
   `natsu-hc`, no wrapper is needed — `cua-driver` already speaks MCP over
   stdio itself (`cua-driver mcp`). This becomes a second section,
   "Computer Use", in `natsu-settings`.
2. **`natsu-browser`**, a local MCP server wrapping `agent-browser`'s core
   interaction commands as structured MCP tools, plus one generic
   passthrough tool for everything else. A third `natsu-settings` section,
   "Browser".
3. **`natsu-browser-view`**, a new mod pane — a 4th tab next to
   Files/Changes/Settings — that polls `agent-browser screenshot` on a
   timer and renders it as a still image, so a person can watch browser
   automation happen without reading text output.

## Scope boundaries (explicitly out)

- No MCP wrapper for `cua-driver` — it already exposes `cua-driver mcp`;
  this pass is install + registration only, same shape as the Claude Code
  registration step for `natsu-hc`, not a new server.js.
- The `agent-browser` wrapper covers only core interaction commands —
  `open`, `click`, `dblclick`, `type`, `fill`, `press`, `screenshot`,
  `snapshot`, `scroll`, `wait`, `get`, `back`, `forward`, `reload`,
  `close` — as named tools, plus one generic `agent_browser_exec` tool
  (raw argv passthrough) for everything else: mouse, network, storage,
  tabs, diff, debug/trace, streaming, react devtools, performance, SPA,
  cookies, clipboard. Hand-schema'ing all ~40 of `agent-browser`'s
  subcommand groups isn't worth it when most of that surface (React
  fiber inspection, SPA router hooks, Core Web Vitals) is far outside
  "an agent drives a browser."
- The live-view panel shows only `agent-browser`'s own screenshot (the
  session it's actively driving), not `cua-driver`'s full-desktop
  capture (`get_desktop_state`/`zoom`) — same polling mechanism could
  extend to that later; not in this pass, and showing the whole desktop
  by default is a bigger privacy/scope step than showing one browser tab.
- No true video streaming. `agent-browser` has a `stream enable`
  WebSocket feature, but Herdr mods can't embed a web view or run a
  WebSocket client inside the render loop the way a page could (AGENTS.md:
  "You can't: use HTML, CSS, a web view"). Periodic still-image polling
  only — the same mechanism `natsu-status` already uses for CPU/RAM.
- `cua-driver`'s `-AutoStart` (register a login scheduled task so
  `cua-driver serve` is always running) isn't wired into the Settings
  button. Left at the installer's own default (off); a person who wants
  it runs the installer's own documented command directly.
- No permission/allowlist UI. Both tools keep whatever default behavior
  their own CLI/binary ships with (`agent-browser`'s
  `AGENT_BROWSER_ACTION_POLICY` env var, `cua-driver`'s `standard`
  permission mode) — not surfaced or overridden from Herdr.
- Uninstalling the `cua-driver` *binary* is out of scope for the Remove
  button (it only runs `claude mcp remove`) — matches `natsu-hc`'s own
  Remove, which doesn't uninstall Node.js either. The official
  `uninstall.ps1` exists for that, run manually.

## Architecture

### `cua-driver` install + registration (`natsu-settings` "Computer Use" section)

- **Install**: run the official installer non-interactively —
  `powershell -NoProfile -Command "irm https://cua.ai/driver/install.ps1 | iex"`.
  Confirmed from the installer script's own header: sudo-free, no admin
  elevation, no Developer Mode requirement (it uses directory junctions,
  not symlinks, for its own atomic-upgrade layout under
  `%USERPROFILE%\.cua-driver\` + `%LOCALAPPDATA%\Programs\Cua\cua-driver\bin`,
  and self-adds that bin dir to the user PATH). Then
  `claude mcp add --transport stdio cua-driver -- cua-driver mcp`
  (same registration style as `natsu-hc`, but a bare command + explicit
  `--transport stdio` instead of `node <path>`, since there's no local
  script — the binary itself is the server).
- **Status checks**, using the same per-step-isolated pattern just added
  to `natsu-hc`'s `refresh()` (see git history — `fs.stat` isn't
  implemented by this runtime's `fs/promises` shim, and `claude mcp list`
  health-checks every registered server and can stall; avoid both):
  - `cua-driver --version` on PATH (`withTimeout`-wrapped `exec`, same
    `CHECK_TIMEOUT_MS`).
  - Registered: read `~/.claude.json`, check `mcpServers.cua-driver`
    (`fs.readFile`, not `claude mcp list`).
- **Remove**: `claude mcp remove -s user cua-driver`, then re-check.

### `agent-browser` MCP wrapper (new `mcp-browser/` folder, sibling of `mcp/`)

- `mcp-browser/package.json` (`"type": "module"`, dependency
  `@modelcontextprotocol/sdk`), `mcp-browser/server.js` — stdio MCP
  server, one tool per kept command plus `agent_browser_exec`.
- Every handler, mirroring `mcp/server.js`'s established shape:
  1. Builds `argv` from the tool's input fields, matching that
     subcommand's own flags one-to-one (pinned down from
     `agent-browser <command> --help` while implementing that tool, not
     guessed here — same discipline as the `hc_*` tools).
  2. Runs `agent-browser` via `execFile` (array args, no shell
     interpolation — the input traces back to an LLM-controlled agent).
  3. Parses stdout as JSON where `agent-browser` emits it (most commands
     support `--json`/default to it for agent use); falls back to raw
     text if parsing fails.
  4. On nonzero exit, returns `{ error: true, code, stdout, stderr }`
     instead of throwing.
  5. If `agent-browser` itself isn't on PATH, every call returns
     `{ error: "agent-browser not found on PATH" }`.
- Tool list: `browser_open`, `browser_click`, `browser_dblclick`,
  `browser_type`, `browser_fill`, `browser_press`, `browser_screenshot`,
  `browser_snapshot`, `browser_scroll`, `browser_wait`, `browser_get`,
  `browser_back`, `browser_forward`, `browser_reload`, `browser_close`,
  `agent_browser_exec(args: string[])`.
- No session/daemon management in the wrapper: `agent-browser` already
  persists its browser across separate CLI invocations via its own
  background daemon ("browser persists via daemon" per its own
  `--help`), so each tool call is just one more `execFile`, same as any
  two chained shell invocations would be.

### `natsu-settings` "Browser" section

Same shape as "Computer Use": status (`agent-browser --version` on PATH
— true today already; registered via `~/.claude.json`'s
`mcpServers.natsu-browser`), Install (`claude mcp add -s user
natsu-browser -- node <repo>/mcp-browser/server.js`) / Remove buttons.
`agent-browser` itself is never (re)installed by this button — it's
already on the machine; if it's missing, the section says so (`npm
install -g agent-browser`) and stops, same as `natsu-hc`'s "no auto-install
of Node.js" boundary.

### `natsu-settings` nav gains two rows

`sections` in `render()` goes from `[{ id: "mcp", ... }]` to three
entries (`mcp`, `computer-use`, `browser`), each with its own icon +
section-render method — the nav rail this session's feedback already
established (`964f42c` / today's restore) is exactly what makes this a
one-array-entry addition instead of new plumbing.

### `natsu-browser-view` mod (new pane, 4th panel tab)

- New folder `mods/natsu-browser-view/`, `mod.json: {"place": "none"}`
  — docked only inside `panel-body`, like `files`/`changes`/`settings`.
- **Screenshot path constraint**: `image(path)` resolves "against the
  application root... not against the file that asked for it" (per
  `gpui-kit.d.ts`'s own doc comment on `svg`/`image`) — i.e. relative to
  `~/.config/herdr-app`, the same rooting `svg("mods/<name>/icon.svg")`
  already uses elsewhere in this repo. A screenshot written to a system
  temp directory would NOT be loadable this way. The poll target is
  therefore a path inside the mod's own folder:
  `mods/natsu-browser-view/.cache/live.png`
  (`exec("agent-browser", ["screenshot",
  "<home>/.config/herdr-app/mods/natsu-browser-view/.cache/live.png"])`,
  then `image("mods/natsu-browser-view/.cache/live.png")`).
- `init`: `cx.timer.every(POLL_MS, (cx) => this.refresh(cx))` — poll
  interval TBD during implementation (start around 2–3s; `natsu-status`
  polls every 6s for machine stats, but a "watch it work" view wants to
  feel closer to live than a status bar does).
- Empty/idle state: before the first screenshot lands, or if
  `agent-browser screenshot` fails (no active session/tab — e.g. no
  `agent-browser open` has run yet), show a plain placeholder ("No
  browser session yet") instead of a broken image.
- No controls in v1 (no click-to-interact) — this is a *viewer*, not a
  remote-control surface; interaction stays with the agent via the MCP
  tools.

### Wiring into the layout

1. `natsu-tabs/main.js`: add a fourth `panelButton("browser-view",
   "Browser", "<icon>")` next to Settings, same `enabled.includes(...)`
   gating (add `"browser-view"` to the hardcoded always-included list
   the way `"settings"` already is — see the comment already in that
   file explaining why: "never gated behind workspace.panels ... always
   included so a space's remembered choice is honored on return").
2. `layouts/natsu.json`: add a `browser-view` child
   (`content.mod: "natsu-browser-view"`) to the existing `panel-body`
   stack alongside `files`/`changes`/`settings`.

## Data flow

**MCP tool calls** (both servers): Agent (MCP client, e.g. Claude Code in
a Herdr terminal) → stdio → `natsu-browser` or `cua-driver` process →
`execFile`/native call → the actual browser (via `agent-browser`'s
daemon + its own Chrome/Chromium instance) or the native desktop (via
`cua-driver`'s platform-windows crate, UIA) → result returned up the
same path.

**Live view**: `natsu-browser-view`'s timer → `exec("agent-browser",
["screenshot", <path under mods/natsu-browser-view/.cache/>])` →
`image()` reads that same file back. Entirely decoupled from the MCP
tool calls above — it's not watching the MCP server's traffic, it's
independently asking the same already-running `agent-browser` daemon
for a fresh screenshot of whatever session is currently open (including
one driven by an agent through the MCP tools, since they share the one
daemon-backed browser).

## Error handling summary

- Both MCP servers: missing binary → clear tool-level error, no stack
  trace. Nonzero exit → structured `{error, code, stdout, stderr}`,
  never thrown. Non-JSON stdout → raw text returned.
- `natsu-settings`'s two new sections: every `exec()` step
  individually `step()`-isolated (this session's fix to `natsu-hc`) so
  one failing check never blocks the others or crashes the section;
  failures shown inline via `lastError`, same as the MCP section today.
- `natsu-browser-view`: a failed/missing screenshot shows the idle
  placeholder, not a broken-image icon or a crashed render.

## Testing / verification

- `herdr-app check` on `natsu-tabs`, `natsu-settings`, and
  `natsu-browser-view` after each is written/edited.
- Manual: toggle the new Browser tab the same way
  Files/Changes/Settings already toggle; confirm it shows a live(ish)
  screenshot once `agent-browser open <url>` has been run from any
  terminal, and the idle placeholder before that.
- `natsu-settings`: click Install for each of the two new sections,
  confirm `claude mcp list` (run from a plain terminal, not through the
  UI) shows the new server; click Remove, confirm it's gone.
- End-to-end: from a Claude Code session in a Herdr terminal, call
  `browser_open` then `browser_snapshot` via the `natsu-browser` MCP
  tools (not shell) and confirm both the tool result and the
  `natsu-browser-view` panel reflect the same page.
- `cua-driver`: after install + registration, call one read-only tool
  (e.g. `get_window_state`) from an MCP-capable agent and confirm it
  returns real window data without prompting (Windows UIA, `standard`
  permission mode is promptless by design).

## Open implementation details (deliberately left for the plan/build step)

- Exact flags per `agent-browser` tool: pinned by reading each
  `agent-browser <command> --help` while building that tool.
- Whether GPUI's `image()` loader caches by path and would need a
  cache-busting trick (alternating filenames, or similar) to show a
  screenshot overwritten in place every poll — verify empirically
  during `natsu-browser-view`'s build; this spec assumes a fresh read
  per render but doesn't guarantee the host doesn't cache.
- Live-view poll interval: start at 2–3s, adjust after trying it.
- `cua-driver`'s exact installed-version pin (`latest` vs. pinning a
  known-good release) — default to `latest` unless that proves
  unstable during implementation.
