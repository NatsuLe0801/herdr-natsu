import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, exec, home, window as appWindow } from "herdr";
import * as fs from "fs/promises";

const MCP_NAME = "natsu-hc";
const REPO_REL = "mods/herdr-natsu/mcp";
const MCP_DIR = `${home()}/.config/herdr-app/${REPO_REL}`;
// On Windows, npm ships only as npm.cmd/npm (no npm.exe); herdr's exec()
// spawns directly without PATHEXT resolution (unlike cmd.exe), so a bare
// "npm" resolves to nothing there even though it's on PATH.
function npmBin() {
  return appWindow()?.platform === "windows" ? "npm.cmd" : "npm";
}

const CHECK_TIMEOUT_MS = 3500;

function safeExec(cmd, args, opts) {
  return exec(cmd, args, opts).catch((err) => ({ code: null, stdout: "", stderr: String(err?.message ?? err) }));
}

// `claude mcp list` spawns and health-checks every registered server
// (including any that are currently broken) just to answer "is natsu-hc
// here" — slow and exactly the kind of call that can stall for a long time.
// The registration itself is a plain JSON file; read that instead.
async function isRegistered() {
  try {
    const raw = await fs.readFile(".claude.json", "utf8");
    return Boolean(JSON.parse(raw)?.mcpServers?.[MCP_NAME]);
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
    this.busy = false;
    this.lastError = null;
    this.status = { node: null, claude: null, registered: null, depsReady: null };
    this.refresh(cx);
  }

  // Sync on purpose: the async work runs inside cx.spawn's own cx, never
  // the cx passed in from a click/init, which goes stale across an await.
  refresh(cx) {
    cx.spawn(async (cx) => {
      const step = async (label, fn) => {
        try { return await fn(); } catch (err) { this.lastError = `${label}: ${err?.message ?? err}`; return null; }
      };
      const node = await step("node", () => withTimeout(safeExec("node", ["--version"]), CHECK_TIMEOUT_MS, cx));
      const hc = await step("hc", () => withTimeout(safeExec("hc", ["--version"]), CHECK_TIMEOUT_MS, cx));
      const claudeVersion = await step("claude", () => withTimeout(safeExec("claude", ["--version"]), CHECK_TIMEOUT_MS, cx));
      const registered = await step("registered", () => isRegistered());
      // fs.stat isn't implemented by this runtime's fs/promises shim (only
      // readFile/writeFile are) — probe a file installed deps always ship,
      // rather than stat-ing the node_modules directory itself.
      // fs reads are rooted at the OS home dir (per AGENTS.md), not ~/.config/herdr-app.
      const depsReady = await step("depsReady", () =>
        fs.readFile(`.config/herdr-app/${REPO_REL}/node_modules/zod/package.json`, "utf8").then(() => true).catch(() => false));
      this.status = {
        node: node?.code === 0,
        hc: hc?.code === 0,
        claude: claudeVersion?.code === 0,
        registered: Boolean(registered),
        depsReady: Boolean(depsReady),
      };
      cx.notify();
    });
  }

  install(cx) {
    if (this.busy) return;
    this.busy = true;
    this.lastError = null;
    cx.notify();
    cx.spawn(async (cx) => {
      if (!this.status.depsReady) {
        const npm = await safeExec(npmBin(), ["install"], { cwd: MCP_DIR });
        if (npm.code !== 0) {
          this.lastError = npm.stderr || "npm install failed";
          this.busy = false;
          cx.notify();
          return;
        }
      }
      const add = await safeExec("claude", ["mcp", "add", "-s", "user", MCP_NAME, "--", "node", `${MCP_DIR}/server.js`]);
      // Already registered is the goal state, not a failure (the status
      // check above can lag behind the real claude config).
      if (add.code !== 0 && !/already exists/i.test(add.stderr)) this.lastError = add.stderr || "claude mcp add failed";
      this.refresh(cx);
      this.busy = false;
      cx.notify();
    });
  }

  remove(cx) {
    if (this.busy) return;
    this.busy = true;
    this.lastError = null;
    cx.notify();
    cx.spawn(async (cx) => {
      const rm = await safeExec("claude", ["mcp", "remove", "-s", "user", MCP_NAME]);
      if (rm.code !== 0) this.lastError = rm.stderr || "claude mcp remove failed";
      this.refresh(cx);
      this.busy = false;
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
  statusPill(t) {
    const on = this.status.registered;
    // null (not checked yet) must read as "checking", not "off" — collapsing
    // it into the red state makes a still-loading screen look broken.
    const color = on == null ? t.dim : on ? (t.done ?? t.accent) : t.blocked;
    const label = on == null ? "Checking…" : on ? "Activated" : "Not connected";
    return h_flex().gap(6).items_center().px(9).py(4).rounded(6).border(1).border_color(color)
      .child(div().size(7).rounded(4).flex_none().bg(color))
      .child(div().text_size(12).font_semibold().text_color(color).child(label));
  }

  mcpSection(t) {
    return v_flex().gap(18)
      .child(h_flex().gap(10).items_center()
        .child(div().size(32).rounded(8).flex_none().flex().items_center().justify_center().bg(t.chrome)
          .child(svg("mods/workspace-chrome/server.svg").size(16).text_color(t.accent)))
        .child(v_flex().flex_1().gap(2)
          .child(div().font_semibold().text_size(16).text_color(t.foreground).child("MCP server"))
          .child(div().text_size(12).text_color(t.dim).child("natsu-hc — full access to hc across every paired machine")))
        .child(this.statusPill(t)))
      .child(v_flex().gap(11).p(16).rounded(10).bg(t.chrome).border(1).border_color(t.border)
        .child(this.statusRow(t, "Node.js on PATH", this.status.node))
        .child(this.statusRow(t, "hc on PATH", this.status.hc))
        .child(this.statusRow(t, "Claude Code CLI on PATH", this.status.claude))
        .child(this.statusRow(t, "Server dependencies installed", this.status.depsReady)))
      .child(v_flex().gap(4)
        .child(div().text_size(11).text_color(t.dim).child("Server path"))
        .child(div().px(10).py(7).rounded(7).bg(t.background).border(1).border_color(t.border)
          .text_size(11.5).text_color(t.dim).child(`${MCP_DIR}/server.js`)))
      .when(Boolean(this.lastError), (el) => el.child(h_flex().gap(8).items_center().p(10).rounded(8)
        .bg(t.chrome).border(1).border_color(t.blocked)
        .child(svg("mods/workspace-chrome/x.svg").size(13).flex_none().text_color(t.blocked))
        .child(div().text_color(t.blocked).text_size(12).child(this.lastError))))
      .child(h_flex().gap(8)
        .when(!this.status.registered, (el) => el.child(this.button(t, "Install", "plus", this.busy, (cx) => this.install(cx))))
        .when(Boolean(this.status.registered), (el) => el.child(this.button(t, "Remove", "minus", this.busy, (cx) => this.remove(cx)))));
  }

  // A single-column version of this page was tried before (see git history)
  // and reported as looking unfinished; the nav rail is what gives it a
  // "settings page" frame even with one section today.
  render(cx) {
    const t = theme();
    const sections = [{ id: "mcp", label: "MCP", icon: "server" }];
    const nav = v_flex().id("settings-nav").w(150).h_full().flex_none().bg(t.chrome).border_r(1).border_color(t.border).p(8).gap(2)
      .children(sections.map((s) => h_flex().id(`settings-nav-${s.id}`).gap(8).px(10).h(32).rounded(6).items_center()
        .bg(this.active === s.id ? t.selected : "transparent").text_color(this.active === s.id ? t.foreground : t.muted)
        .text_size(13).cursor_pointer().hover((el) => el.bg(t.hover)).on_click((_e, cx) => { this.active = s.id; cx.notify(); })
        .child(svg(`mods/workspace-chrome/${s.icon}.svg`).size(14).flex_none())
        .child(s.label)));
    const content = v_flex().id("settings-content").flex_1().min_w(0).h_full().overflow_y_scrollbar().p(20).child(this.mcpSection(t));
    return h_flex().id("settings-root").size_full().min_h(0).items_start().bg(t.background)
      .child(nav)
      .child(content);
  }
}
