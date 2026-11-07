import { View, div, image } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { exec, home, theme } from "herdr";
import * as fs from "fs/promises";
import { fitImage, nextSessionName, pageValue, reconcileSessions } from "./session.js";

const POLL_MS = 2500;
const SHOT_REL = "mods/herdr-natsu/mods/natsu-browser-view/live.png";
const SHOT_ABS = `${home()}/.config/herdr-app/mods/natsu-browser-view/live.png`;
const RUNNER = `${home()}/.config/herdr-app/mods/herdr-natsu/mcp-browser/run-cli.js`;

function agentBrowser(args) {
  return exec("node", [RUNNER, ...args])
    .catch((err) => ({ code: null, stdout: "", stderr: String(err?.message ?? err) }));
}

function pngSize(buf) {
  if (buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50) return null;
  const u32 = (i) => ((buf[i] << 24) | (buf[i + 1] << 16) | (buf[i + 2] << 8) | buf[i + 3]) >>> 0;
  return { w: u32(16), h: u32(20) };
}

export default class NatsuBrowserView extends View {
  init(_props, cx) {
    this.sessions = [];
    this.session = null;
    this.hasShot = false;
    this.imgW = 0;
    this.imgH = 0;
    this.previewW = 0;
    this.previewH = 0;
    this.polling = false;
    this.actionBusy = false;
    this.refreshQueued = false;
    this.editingUrl = false;
    this.error = null;
    this.url = InputState.new({ placeholder: "Enter a URL…" });
    this.url.on("focus", () => { this.editingUrl = true; });
    this.url.on("blur", () => { this.editingUrl = false; });
    this.url.on("submit", (_e, cx) => this.navigate(cx));
    this.timer = cx.timer.every(POLL_MS, (cx) => this.refresh(cx));
  }

  close() {
    this.closed = true;
    this.url?.release();
    if (this.timer && !this.timer.is_done()) this.timer.cancel();
  }

  perform(cx, args, onSuccess) {
    if (this.actionBusy) return;
    this.actionBusy = true;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      const result = await agentBrowser(args);
      if (result.code === 0) onSuccess?.();
      else this.error = result.stderr || "agent-browser command failed";
      this.actionBusy = false;
      if (!this.closed) this.refresh(cx);
    });
  }

  navigate(cx) {
    const url = this.url.value().trim();
    if (!url) return;
    const session = this.session ?? nextSessionName(this.sessions);
    this.perform(cx, ["open", "--session", session, url], () => {
      this.session = session;
      this.hasShot = false;
    });
  }

  addSession(cx) {
    const session = nextSessionName(this.sessions);
    this.perform(cx, ["open", "--session", session], () => {
      this.session = session;
      this.hasShot = false;
      this.url.set_value("");
    });
  }

  closeSession(cx, session) {
    this.perform(cx, ["close", "--session", session], () => {
      if (this.session === session) this.session = null;
      this.hasShot = false;
    });
  }

  chooseSession(cx, session) {
    if (this.actionBusy || this.session === session) return;
    this.session = session;
    this.hasShot = false;
    this.error = null;
    if (!this.editingUrl) this.url.set_value("");
    cx.notify();
    this.refresh(cx);
  }

  refresh(cx) {
    if (this.closed) return;
    if (this.actionBusy || this.polling) {
      this.refreshQueued = true;
      return;
    }
    this.refreshQueued = false;
    this.polling = true;
    const requested = this.session;
    cx.spawn(async (cx) => {
      try {
        const list = await agentBrowser(["session", "list", "--json"]);
        const state = list.code === 0 ? reconcileSessions(list.stdout, requested, this.session) : null;
        if (!state) return;
        let hasShot = false;
        let pageUrl = null;

        if (state.session) {
          const [shot, url] = await Promise.all([
            agentBrowser(["screenshot", "--session", state.session, SHOT_ABS]),
            agentBrowser(["get", "url", "--session", state.session, "--json"]),
          ]);
          if (this.session !== requested) return;
          const size = shot.code === 0 ? pngSize(await fs.readFile(SHOT_ABS).catch(() => new Uint8Array(0))) : null;
          if (size) {
            this.imgW = size.w;
            this.imgH = size.h;
            hasShot = true;
          }
          if (url.code === 0) pageUrl = pageValue(url.stdout, "url");
        }

        this.sessions = state.sessions;
        this.session = state.session;
        this.hasShot = hasShot;
        if (!this.editingUrl) this.url.set_value(pageUrl ?? "");
      } finally {
        this.polling = false;
        if (!this.closed && this.refreshQueued) this.refresh(cx);
        else if (!this.closed) cx.notify();
      }
    });
  }

  sessionTabs(t) {
    const tabs = this.sessions.map((session, index) => {
      const active = session === this.session;
      return h_flex().id(`browser-session-${index}`).h(26).gap(6).px(8).rounded(6).items_center().flex_none()
        .bg(active ? t.selected : t.chrome).text_color(active ? t.foreground : t.muted)
        .cursor_pointer().hover((el) => el.bg(t.hover))
        .on_click((_e, cx) => this.chooseSession(cx, session))
        .child(div().max_w(84).truncate().text_size(11.5).child(session))
        .child(div().id(`browser-session-close-${index}`).text_size(13).text_color(t.dim)
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_click((_e, cx) => { cx.stop_propagation(); this.closeSession(cx, session); })
          .child("×"));
    });

    return h_flex().id("browser-session-tabs").w_full().h(30).gap(4).items_center().overflow_x_scrollbar()
      .children(tabs)
      .child(h_flex().id("browser-session-add").size(26).rounded(6).items_center().justify_center().flex_none()
        .bg(t.chrome).text_color(t.muted).text_size(16)
        .when(!this.actionBusy, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.addSession(cx)))
        .child("+"));
  }

  urlBar(t) {
    return h_flex().w_full().h(30).gap(6)
      .child(div().flex_1().min_w(0).h_full().px(8).flex().items_center().rounded(7).border(1)
        .border_color(this.editingUrl ? t.accent : t.input).bg(t.background)
        .child(Input.new(this.url).w_full().h_full().text_size(12).text_color(t.foreground)))
      .child(h_flex().id("browser-url-go").h_full().px(10).rounded(7).items_center().justify_center().flex_none()
        .bg(this.actionBusy ? t.chrome : t.solid).text_color(this.actionBusy ? t.dim : t.solid_foreground).text_size(12)
        .when(!this.actionBusy, (el) => el.cursor_pointer().hover((s) => s.bg(t.accent)).on_click((_e, cx) => this.navigate(cx)))
        .child("Go"));
  }

  render(cx) {
    if (!this._started) {
      this._started = true;
      this.refresh(cx);
    }
    const t = theme();
    const root = v_flex().id("browser-view-root").size_full().min_h(0).bg(t.background)
      .on_size_change((size, cx) => {
        const previewH = Math.max(0, size.height - 82);
        if (size.width === this.previewW && previewH === this.previewH) return;
        this.previewW = size.width;
        this.previewH = previewH;
        cx.notify();
      })
      .child(v_flex().w_full().p(8).gap(6).flex_none().bg(t.chrome).border_b(1).border_color(t.border)
        .child(this.sessionTabs(t))
        .child(this.urlBar(t)));
    const content = v_flex().id("browser-preview").flex_1().min_h(0).w_full().items_center().justify_center().p(16);

    if (this.error) return root.child(content.child(div().text_color(t.blocked).text_size(12).child(this.error)));
    if (!this.session) return root.child(content.child(div().text_color(t.dim).text_size(13).child("Enter a URL or add a tab")));
    if (!this.hasShot) return root.child(content.child(div().text_color(t.dim).text_size(13).child("Loading browser…")));

    const size = fitImage(this.previewW, this.previewH, this.imgW, this.imgH);
    return root.child(content.when(size.w > 0, (el) => el.child(image(SHOT_REL).w(size.w).h(size.h))));
  }
}
