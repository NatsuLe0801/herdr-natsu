import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, exec, home, window as appWindow } from "herdr";
import * as fs from "fs/promises";

const REPO_REL = "mods/herdr-natsu/mcp";
const MCP_DIR = `${home()}/.config/herdr-app/${REPO_REL}`;
// On Windows, npm ships only as npm.cmd/npm (no npm.exe); herdr's exec()
// spawns directly without PATHEXT resolution (unlike cmd.exe), so a bare
// "npm" resolves to nothing there even though it's on PATH.
function npmBin() {
  return appWindow()?.platform === "windows" ? "npm.cmd" : "npm";
}

const BROWSER_REPO_REL = "mods/herdr-natsu/mcp-browser";
const BROWSER_DIR = `${home()}/.config/herdr-app/${BROWSER_REPO_REL}`;

const CHECK_TIMEOUT_MS = 3500;

// Every section this settings page manages: a prereq checklist, an optional
// deps-install step, and a `claude mcp add`/`remove` pair. Tasks after this
// one add more entries here — pure data, no engine changes.
const SECTIONS = [
  {
    id: "mcp",
    label: "MCP",
    icon: "server",
    title: "MCP server",
    subtitle: "natsu-hc — full access to hc across every paired machine",
    serverName: "natsu-hc",
    checks: [
      { key: "node", label: "Node.js on PATH", bin: "node", args: ["--version"] },
      { key: "hc", label: "hc on PATH", bin: "hc", args: ["--version"] },
      { key: "claude", label: "Claude Code CLI on PATH", bin: "claude", args: ["--version"] },
    ],
    // fs.stat isn't implemented by this runtime's fs/promises shim (only
    // readFile/writeFile are) — probe a file installed deps always ship,
    // rather than stat-ing the node_modules directory itself.
    // fs reads are rooted at the OS home dir (per AGENTS.md), not ~/.config/herdr-app.
    depsCheck: { label: "Server dependencies installed", path: `.config/herdr-app/${REPO_REL}/node_modules/zod/package.json` },
    prepCmd: { bin: npmBin(), args: ["install"], opts: { cwd: MCP_DIR } },
    skipPrepWhenDepsReady: true,
    mcpAddArgs: ["--", "node", `${MCP_DIR}/server.js`],
    pathLabel: `${MCP_DIR}/server.js`,
  },
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
  },
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
  },
];

function safeExec(cmd, args, opts) {
  return exec(cmd, args, opts).catch((err) => ({ code: null, stdout: "", stderr: String(err?.message ?? err) }));
}

// `claude mcp list` spawns and health-checks every registered server
// (including any that are currently broken) just to answer "is this server
// here" — slow and exactly the kind of call that can stall for a long time.
// The registration itself is a plain JSON file; read that instead.
async function isRegistered(serverName) {
  try {
    const raw = await fs.readFile(".claude.json", "utf8");
    return Boolean(JSON.parse(raw)?.mcpServers?.[serverName]);
  } catch {
    return false;
  }
}

// A hung child process (no PATH entry that just never answers) must not wedge
// refresh() forever: without a bound, the status rows below sit on their
// "clock" icon and the Activated pill reads "Not connected" permanently, even
// once the server really is connected.
function withTimeout(promise, ms, cx) {
  return new Promise((resolve) => {
    let settled = false;
    // One-shot check: not worth tracking/cancelling the timer (natsu-status
    // does, but that's a repeating poller; this is a single refresh run).
    cx.timer.after(ms, () => {
      if (!settled) { settled = true; resolve({ code: null, stdout: "", stderr: "timeout" }); }
    });
    promise.then((r) => {
      if (!settled) { settled = true; resolve(r); }
    });
  });
}

export default class NatsuSettings extends View {
  init(_props, cx) {
    this.active = "mcp";
    this.busy = {};
    this.lastError = {};
    this.status = {};
    for (const s of SECTIONS) this.refresh(cx, s.id);
  }

  // Sync on purpose: the async work runs inside cx.spawn's own cx, never
  // the cx passed in from a click/init, which goes stale across an await.
  refresh(cx, sectionId) {
    const section = SECTIONS.find((s) => s.id === sectionId);
    cx.spawn(async (cx) => {
      const step = async (label, fn) => {
        try { return await fn(); } catch (err) { this.lastError[sectionId] = `${label}: ${err?.message ?? err}`; return null; }
      };
      const checkEntries = section.checks.map(async (c) => {
        const result = await step(c.key, () => withTimeout(safeExec(c.bin, c.args), CHECK_TIMEOUT_MS, cx));
        return [c.key, result?.code === 0];
      });
      const registeredEntry = step("registered", () => isRegistered(section.serverName)).then((r) => ["registered", Boolean(r)]);
      const depsEntry = section.depsCheck
        ? step("depsReady", () => fs.readFile(section.depsCheck.path, "utf8").then(() => true).catch(() => false)).then((r) => ["depsReady", Boolean(r)])
        : Promise.resolve(["depsReady", true]);
      const entries = await Promise.all([...checkEntries, registeredEntry, depsEntry]);
      this.status[sectionId] = Object.fromEntries(entries);
      cx.notify();
    });
  }

  install(cx, sectionId) {
    const section = SECTIONS.find((s) => s.id === sectionId);
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
      // Already registered is the goal state, not a failure (the status
      // check above can lag behind the real claude config).
      if (add.code !== 0 && !/already exists/i.test(add.stderr)) this.lastError[sectionId] = add.stderr || "claude mcp add failed";
      this.refresh(cx, sectionId);
      this.busy[sectionId] = false;
      cx.notify();
    });
  }

  remove(cx, sectionId) {
    const section = SECTIONS.find((s) => s.id === sectionId);
    if (this.busy[sectionId]) return;
    this.busy[sectionId] = true;
    this.lastError[sectionId] = null;
    cx.notify();
    cx.spawn(async (cx) => {
      const rm = await safeExec("claude", ["mcp", "remove", "-s", "user", section.serverName]);
      if (rm.code !== 0) this.lastError[sectionId] = rm.stderr || "claude mcp remove failed";
      this.refresh(cx, sectionId);
      this.busy[sectionId] = false;
      cx.notify();
    });
  }

  button(t, label, icon, busy, onClick) {
    return h_flex().id(`settings-btn-${label}`).gap(7).px(13).h(30).rounded(7).items_center().justify_center()
      .bg(busy ? t.chrome : t.solid).text_color(busy ? t.dim : t.solid_foreground).text_size(12.5)
      .when(!busy, (el) => el.cursor_pointer().hover((s) => s.bg(t.accent)).on_click((_e, cx) => onClick(cx)))
      .child(busy
        ? svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().spin(900)
        : svg(`mods/workspace-chrome/${icon}.svg`).size(12).flex_none())
      .child(busy ? "Please wait…" : label);
  }

  statusRow(t, label, ok) {
    const icon = ok == null ? "clock" : ok ? "circle-check" : "x";
    const color = ok == null ? t.dim : ok ? (t.done ?? t.accent) : t.blocked;
    return h_flex().gap(9).items_center()
      .child(svg(`mods/workspace-chrome/${icon}.svg`).size(14).flex_none().text_color(color))
      .child(div().text_color(t.foreground).text_size(13).child(label));
  }

  // The prereq checklist below is diagnostic detail; this is the one thing
  // that answers "is it on": a dot + word, not buried as a sixth checklist row.
  statusPill(t, sectionId) {
    const on = this.status[sectionId]?.registered;
    // null (not checked yet) must read as "checking", not "off" — collapsing
    // it into the red state makes a still-loading screen look broken.
    const color = on == null ? t.dim : on ? (t.done ?? t.accent) : t.blocked;
    const label = on == null ? "Checking…" : on ? "Activated" : "Not connected";
    return h_flex().gap(6).items_center().px(9).py(4).rounded(6).border(1).border_color(color)
      .child(div().size(7).rounded(4).flex_none().bg(color))
      .child(div().text_size(12).font_semibold().text_color(color).child(label));
  }

  sectionBody(t, section) {
    const status = this.status[section.id] ?? {};
    const lastError = this.lastError[section.id];
    const busy = this.busy[section.id];
    return v_flex().gap(18)
      .child(h_flex().gap(10).items_center()
        .child(div().size(32).rounded(8).flex_none().flex().items_center().justify_center().bg(t.chrome)
          .child(svg(`mods/workspace-chrome/${section.icon}.svg`).size(16).text_color(t.accent)))
        .child(v_flex().flex_1().gap(2)
          .child(div().font_semibold().text_size(16).text_color(t.foreground).child(section.title))
          .child(div().text_size(12).text_color(t.dim).child(section.subtitle)))
        .child(this.statusPill(t, section.id)))
      .child(v_flex().gap(11).p(16).rounded(10).bg(t.chrome).border(1).border_color(t.border)
        .children(section.checks.map((c) => this.statusRow(t, c.label, status[c.key])))
        .when(Boolean(section.depsCheck), (el) => el.child(this.statusRow(t, section.depsCheck.label, status.depsReady))))
      .child(v_flex().gap(4)
        .child(div().text_size(11).text_color(t.dim).child("Server path"))
        .child(div().px(10).py(7).rounded(7).bg(t.background).border(1).border_color(t.border)
          .text_size(11.5).text_color(t.dim).child(section.pathLabel)))
      .when(Boolean(lastError), (el) => el.child(h_flex().gap(8).items_center().p(10).rounded(8)
        .bg(t.chrome).border(1).border_color(t.blocked)
        .child(svg("mods/workspace-chrome/x.svg").size(13).flex_none().text_color(t.blocked))
        .child(div().text_color(t.blocked).text_size(12).child(lastError))))
      .child(h_flex().gap(8)
        .when(!status.registered, (el) => el.child(this.button(t, "Install", "plus", busy, (cx) => this.install(cx, section.id))))
        .when(Boolean(status.registered), (el) => el.child(this.button(t, "Remove", "minus", busy, (cx) => this.remove(cx, section.id)))));
  }

  // A single-column version of this page was tried before (see git history)
  // and reported as looking unfinished; the nav rail is what gives it a
  // "settings page" frame even with one section today.
  render(cx) {
    const t = theme();
    const nav = v_flex().id("settings-nav").w(150).h_full().flex_none().bg(t.chrome).border_r(1).border_color(t.border).p(8).gap(2)
      .children(SECTIONS.map((s) => h_flex().id(`settings-nav-${s.id}`).gap(8).px(10).h(32).rounded(6).items_center()
        .bg(this.active === s.id ? t.selected : t.chrome).text_color(this.active === s.id ? t.foreground : t.muted)
        .text_size(13).cursor_pointer().hover((el) => el.bg(t.hover)).on_click((_e, cx) => { this.active = s.id; cx.notify(); })
        .child(svg(`mods/workspace-chrome/${s.icon}.svg`).size(14).flex_none())
        .child(s.label)));
    const activeSection = SECTIONS.find((s) => s.id === this.active);
    const content = v_flex().id("settings-content").flex_1().min_w(0).h_full().overflow_y_scrollbar().p(20).child(this.sectionBody(t, activeSection));
    return h_flex().id("settings-root").size_full().min_h(0).items_start().bg(t.background)
      .child(nav)
      .child(content);
  }
}
