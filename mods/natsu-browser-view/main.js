import { View, div, image } from "gpui-kit";
import { v_flex } from "gpui-base";
import { exec, home, theme, window as appWindow } from "herdr";
import * as fs from "fs/promises";
import { selectSession } from "./session.js";

const POLL_MS = 2500;
// image() paths resolve from ~/.config/herdr-app; the same file is written via the absolute path below.
const SHOT_REL = "mods/herdr-natsu/mods/natsu-browser-view/live.png";
// Panel width (368px) minus root padding (2 x 16px).
// ponytail: fixed constant; update if the panel default width in layouts/natsu.json changes.
const PANEL_W = 336;

// herdr's exec() spawns directly with no PATHEXT resolution, and agent-browser
// is an npm .cmd shim on Windows, so route it through cmd.exe. Args are always
// fixed/locally computed. appWindow() is null at module-eval and init(), so the
// platform check must happen at call time.
function agentBrowser(args) {
  const run = appWindow()?.platform === "windows"
    ? exec("cmd.exe", ["/c", "agent-browser.cmd", ...args])
    : exec("agent-browser", args);
  return run.catch((err) => ({ code: null, stdout: "", stderr: String(err?.message ?? err) }));
}

// Width/height from the PNG IHDR chunk (agent-browser always writes PNG).
function pngSize(buf) {
  if (buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50) return null;
  const u32 = (i) => ((buf[i] << 24) | (buf[i + 1] << 16) | (buf[i + 2] << 8) | buf[i + 3]) >>> 0;
  return { w: u32(16), h: u32(20) };
}

export default class NatsuBrowserView extends View {
  init(_props, cx) {
    this.hasShot = false;
    this.imgW = 0;
    this.imgH = 0;
    this.busy = false;
    // The first refresh runs from render(): appWindow() is still null here.
    this.timer = cx.timer.every(POLL_MS, (cx) => this.refresh(cx));
  }

  close() {
    if (this.timer && !this.timer.is_done()) this.timer.cancel();
  }

  refresh(cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        // Never let an implicit screenshot create or target the wrong session.
        const list = await agentBrowser(["session", "list", "--json"]);
        const session = list.code === 0 ? selectSession(list.stdout) : null;
        let hasShot = false;
        if (session) {
          const abs = `${home()}/.config/herdr-app/${SHOT_REL.replace("mods/herdr-natsu/", "")}`;
          const r = await agentBrowser(["screenshot", "--session", session, abs]);
          const size = r.code === 0 ? pngSize(await fs.readFile(abs).catch(() => new Uint8Array(0))) : null;
          if (size) {
            this.imgW = size.w;
            this.imgH = size.h;
            hasShot = true;
          }
        }
        this.hasShot = hasShot;
      } finally {
        this.busy = false;
        cx.notify();
      }
    });
  }

  render(cx) {
    if (!this._started) {
      this._started = true;
      this.refresh(cx);
    }
    const t = theme();
    const root = v_flex().id("browser-view-root").size_full().min_h(0).bg(t.background).items_center().justify_center().p(16);
    if (!this.hasShot) {
      return root.child(div().text_color(t.dim).text_size(13).child("No browser session yet"));
    }
    const scale = Math.min(1, PANEL_W / this.imgW);
    return root.child(image(SHOT_REL).w(Math.floor(this.imgW * scale)).h(Math.floor(this.imgH * scale)));
  }
}
