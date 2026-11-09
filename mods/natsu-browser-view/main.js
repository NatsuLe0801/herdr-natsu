import { View, div, image } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { exec, home, theme } from "herdr";
import * as fs from "fs/promises";
import { browserViewport, fitImage, navigationUrl, nextSessionName, nextShotIndex, pageValue, reconcileSessions, sameImage, shouldTrackUrlChange, syncUrlDraft } from "./session.js";

const POLL_MS = 2500;
const URL_COMMIT_MS = 300;
const SHOT_RELS = [
  "mods/herdr-natsu/mods/natsu-browser-view/live-a.png",
  "mods/herdr-natsu/mods/natsu-browser-view/live-b.png",
];
const SHOT_ABS = [
  `${home()}/.config/herdr-app/mods/natsu-browser-view/live-a.png`,
  `${home()}/.config/herdr-app/mods/natsu-browser-view/live-b.png`,
];
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
    this.shotIndex = null;
    this.lastShot = null;
    this.previewW = 0;
    this.previewH = 0;
    this.rootH = 0;
    this.toolbarH = 82;
    this.polling = false;
    this.actionBusy = false;
    this.submittingUrl = false;
    this.refreshQueued = false;
    this.revision = 0;
    this.editingUrl = false;
    this.urlDirty = false;
    this.syncingUrl = false;
    this.viewportKey = null;
    this.error = null;
    this.url = InputState.new({ placeholder: "Enter a URL…" });
    this.urlDraft = "";
    this.url.on("focus", () => { this.editingUrl = true; });
    this.url.on("blur", () => { this.editingUrl = false; });
    this.url.on("change", () => {
      if (!shouldTrackUrlChange(this.syncingUrl)) return;
      this.urlDraft = this.url.value();
      this.urlDirty = true;
    });
    this.url.on("submit", (_e, cx) => this.submitUrl(cx));
    this.timer = cx.timer.every(POLL_MS, (cx) => this.refresh(cx));
  }

  close() {
    this.closed = true;
    this.url?.release();
    if (this.timer && !this.timer.is_done()) this.timer.cancel();
  }

  setUrl(value, dirty = false) {
    this.syncingUrl = true;
    this.url.set_value(value);
    this.syncingUrl = false;
    this.urlDraft = value;
    this.urlDirty = dirty;
  }

  perform(cx, args, onSuccess) {
    if (this.actionBusy) return;
    this.actionBusy = true;
    this.revision += 1;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      const result = await agentBrowser(args);
      this.actionBusy = false;
      if (this.closed) return;
      if (result.code === 0) onSuccess?.();
      else this.error = result.stderr || "agent-browser command failed";
      this.refresh(cx);
    });
  }

  submitUrl(cx) {
    if (this.actionBusy || this.submittingUrl) return;
    this.submittingUrl = true;
    this.revision += 1;
    cx.timer.after(URL_COMMIT_MS, (cx) => {
      if (this.closed) return;
      const value = this.url.value().trim();
      if (value) {
        this.urlDraft = value;
        this.urlDirty = true;
      }
      this.submittingUrl = false;
      this.navigate(cx);
    });
  }

  navigate(cx) {
    const value = this.urlDirty ? this.urlDraft : this.url.value();
    const url = navigationUrl(value);
    if (!url) {
      if (value.trim()) {
        this.error = "URL cannot start with a dash.";
        cx.notify();
      }
      return;
    }
    const session = this.session ?? nextSessionName(this.sessions);
    this.perform(cx, ["open", "--session", session, url], () => {
      this.session = session;
      this.hasShot = false;
      this.urlDirty = false;
      this.viewportKey = null;
    });
  }

  addSession(cx) {
    const session = nextSessionName(this.sessions);
    this.perform(cx, ["open", "--session", session], () => {
      this.session = session;
      this.hasShot = false;
      this.viewportKey = null;
      this.setUrl("");
    });
  }

  closeSession(cx, session) {
    this.perform(cx, ["close", "--session", session], () => {
      if (this.session === session) this.session = null;
      this.hasShot = false;
      this.viewportKey = null;
    });
  }

  chooseSession(cx, session) {
    if (this.actionBusy || this.session === session) return;
    this.revision += 1;
    this.session = session;
    this.hasShot = false;
    this.error = null;
    this.editingUrl = false;
    this.setUrl("");
    cx.notify();
    this.refresh(cx);
  }

  refresh(cx) {
    if (this.closed) return;
    if (this.actionBusy || this.submittingUrl || this.polling) {
      this.refreshQueued = true;
      return;
    }
    this.refreshQueued = false;
    this.polling = true;
    const requested = this.session;
    const requestedRevision = this.revision;
    cx.spawn(async (cx) => {
      try {
        const list = await agentBrowser(["session", "list", "--json"]);
        const state = list.code === 0
          ? reconcileSessions(list.stdout, requested, this.session, requestedRevision, this.revision)
          : null;
        if (!state || this.closed) return;
        let hasShot = state.session ? this.hasShot : false;
        let pageUrl = null;

        if (state.session) {
          const viewport = browserViewport(this.previewW, this.previewH);
          const viewportKey = viewport ? `${state.session}:${viewport.w}x${viewport.h}` : null;
          if (viewport && viewportKey !== this.viewportKey) {
            const resized = await agentBrowser(["set", "viewport", String(viewport.w), String(viewport.h), "--session", state.session]);
            if (this.closed || this.session !== requested || this.revision !== requestedRevision) return;
            if (resized.code === 0) this.viewportKey = viewportKey;
          }
          const nextIndex = nextShotIndex(this.shotIndex);
          const [shot, url] = await Promise.all([
            agentBrowser(["screenshot", "--session", state.session, SHOT_ABS[nextIndex]]),
            agentBrowser(["get", "url", "--session", state.session, "--json"]),
          ]);
          if (this.closed || this.session !== requested || this.revision !== requestedRevision) return;
          const bytes = shot.code === 0 ? await fs.readFile(SHOT_ABS[nextIndex]).catch(() => new Uint8Array(0)) : new Uint8Array(0);
          if (this.closed || this.session !== requested || this.revision !== requestedRevision) return;
          const size = pngSize(bytes);
          if (size) {
            if (!sameImage(this.lastShot, bytes)) {
              this.lastShot = bytes;
              this.shotIndex = nextIndex;
            }
            this.imgW = size.w;
            this.imgH = size.h;
            hasShot = this.shotIndex != null;
          }
          if (url.code === 0) pageUrl = pageValue(url.stdout, "url");
        }

        if (this.closed || this.session !== requested || this.revision !== requestedRevision) return;
        this.sessions = state.sessions;
        this.session = state.session;
        this.hasShot = hasShot;
        const nextUrl = syncUrlDraft(this.urlDraft, pageUrl, this.urlDirty);
        if (nextUrl !== this.url.value()) this.setUrl(nextUrl, this.urlDirty);
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
    const busy = this.actionBusy || this.submittingUrl;
    return h_flex().w_full().h(30).gap(6)
      .child(div().flex_1().min_w(0).h_full().px(8).flex().items_center().rounded(7).border(1)
        .border_color(this.editingUrl ? t.accent : t.input).bg(t.background)
        .child(Input.new(this.url).w_full().h_full().text_size(12).text_color(t.foreground)))
      .child(h_flex().id("browser-url-go").h_full().px(10).rounded(7).items_center().justify_center().flex_none()
        .bg(busy ? t.chrome : t.solid).text_color(busy ? t.dim : t.solid_foreground).text_size(12)
        .when(!busy, (el) => el.cursor_pointer().hover((s) => s.bg(t.accent)).on_click((_e, cx) => this.submitUrl(cx)))
        .child("Go"));
  }

  render(cx) {
    if (!this._started) {
      this._started = true;
      this.refresh(cx);
    }
    const t = theme();
    const toolbar = v_flex().id("browser-toolbar").w_full().p(8).gap(6).flex_none().bg(t.chrome).border_b(1).border_color(t.border)
      .on_size_change((size, cx) => {
        if (size.height === this.toolbarH) return;
        this.toolbarH = size.height;
        this.previewH = Math.max(0, this.rootH - this.toolbarH);
        cx.notify();
      })
      .child(this.sessionTabs(t))
      .child(this.urlBar(t))
      .when(Boolean(this.error), (el) => el.child(div().w_full().truncate().text_size(11).text_color(t.blocked).child(this.error)));
    const root = v_flex().id("browser-view-root").size_full().min_h(0).bg(t.background)
      .on_size_change((size, cx) => {
        const previewH = Math.max(0, size.height - this.toolbarH);
        if (size.width === this.previewW && previewH === this.previewH) return;
        this.rootH = size.height;
        this.previewW = size.width;
        this.previewH = previewH;
        cx.notify();
      })
      .child(toolbar);
    const content = v_flex().id("browser-preview").flex_1().min_h(0).w_full().items_center().justify_center().p(16);

    if (!this.session) return root.child(content.child(div().text_color(t.dim).text_size(13).child("Enter a URL or add a tab")));
    if (!this.hasShot) return root.child(content.child(div().text_color(t.dim).text_size(13).child("Loading browser…")));

    const size = fitImage(this.previewW, this.previewH, this.imgW, this.imgH);
    return root.child(content.when(size.w > 0 && this.shotIndex != null, (el) => el.child(image(SHOT_RELS[this.shotIndex]).w(size.w).h(size.h))));
  }
}
