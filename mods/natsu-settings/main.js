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
    const row = (label, ok) => h_flex().gap(8).items_center()
      .child(div().size(7).rounded(4).flex_none().bg(ok == null ? t.dim : ok ? (t.done ?? t.accent) : t.blocked))
      .child(div().text_color(t.foreground).child(label));
    return v_flex().gap(16)
      .child(v_flex().gap(2)
        .child(div().font_semibold().text_size(16).child("MCP server"))
        .child(div().text_size(12).text_color(t.dim).child("natsu-hc — full access to hc across every paired machine")))
      .child(v_flex().gap(9).p(14).rounded(8).bg(t.chrome).border(1).border_color(t.border)
        .child(row("Node.js on PATH", this.status.node))
        .child(row("hc on PATH", this.status.hc))
        .child(row("Claude Code CLI on PATH", this.status.claude))
        .child(row("Server dependencies installed", this.status.depsReady))
        .child(row(this.status.registered ? "Registered with Claude Code" : "Not registered", this.status.registered)))
      .child(div().text_size(12).text_color(t.dim).child(`${MCP_DIR}/server.js`))
      .when(Boolean(this.lastError), (el) => el.child(div().text_color(t.blocked).text_size(12).child(this.lastError)))
      .child(h_flex().gap(8)
        .when(!this.status.registered, (el) => el.child(this.button(t, "Install", this.busy, (cx) => this.install(cx))))
        .when(Boolean(this.status.registered), (el) => el.child(this.button(t, "Remove", this.busy, (cx) => this.remove(cx)))));
  }

  render(cx) {
    const t = theme();
    const sections = [{ id: "mcp", label: "MCP" }];
    const nav = v_flex().id("settings-nav").w(170).h_full().flex_none().bg(t.chrome).border_r(1).border_color(t.border).p(10).gap(2)
      .children(sections.map((s) => div().id(`settings-nav-${s.id}`).px(10).h(32).rounded(6).flex().items_center()
        .bg(this.active === s.id ? t.selected : "transparent").text_color(this.active === s.id ? t.foreground : t.muted)
        .cursor_pointer().hover((el) => el.bg(t.hover)).on_click((_e, cx) => { this.active = s.id; cx.notify(); }).child(s.label)));
    const content = v_flex().id("settings-content").flex_1().min_w(0).h_full().overflow_y_scrollbar().p(20).child(this.mcpSection(t));
    return h_flex().id("settings-root").size_full().min_h(0).items_start().bg(t.background)
      .child(nav)
      .child(content);
  }
}
