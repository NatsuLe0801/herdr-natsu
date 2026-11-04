// Status bar: the active space's machine, agent counts, then a CPU/RAM/GPU
// pill for this computer and every remote machine (hc machine ls). Windows
// reads its own counters through PowerShell; remote machines (assumed Linux)
// read /proc, same as a plain SSH host. GPU is NVIDIA-only (nvidia-smi);
// a machine without it just shows no GPU figure.

import { View, div, svg, PathBuilder } from "gpui-kit";
import { h_flex } from "gpui-base";
// `window` the gpui-kit global (paint_path) and herdr's `window()` (platform)
// share a name: herdr's is imported under appWindow to keep both reachable.
import { spaces, agents, theme, run, window as appWindow, keys, hc, exec, machines } from "herdr";

const POLL_MS = 6000;
const TIMEOUT_MS = 3500;
// Local WMI (Win32_PerfFormattedData_PerfOS_Processor) can be slow to spin up
// its first time; no network round trip to worry about locally, so it gets
// more room than a remote host's /proc read.
const LOCAL_TIMEOUT_MS = 8000;

function pct(used, total) {
  return total > 0 ? Math.round((used / total) * 100) : 0;
}

// A point on a circle of radius r centered at (c, c), `deg` clockwise from
// the top (12 o'clock = 0deg, 3 o'clock = 90deg).
function onCircle(c, r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [c + r * Math.cos(rad), c + r * Math.sin(rad)];
}

// One stroked arc from `start` to `end` degrees (clockwise); a sweep near
// 360 is split in two since a single arc_to can't close on itself.
function arcPath(c, r, strokeWidth, start, end) {
  const pb = PathBuilder.stroke(strokeWidth);
  const draw = (a, b) => {
    const [sx, sy] = onCircle(c, r, a), [ex, ey] = onCircle(c, r, b);
    pb.move_to(sx, sy).arc_to(r, r, 0, b - a > 180, true, ex, ey);
  };
  if (end - start >= 359.9) { draw(start, start + 180); draw(start + 180, start + 360); }
  else if (end - start > 0.5) draw(start, end);
  return pb.build();
}

// A small progress ring: a dim full-circle track, then a colored arc for
// `percent` (0..100). Diameter `size` px, stroke scales with it.
function ring(size, percent, color, track) {
  const stroke = Math.max(2, Math.round(size * 0.22));
  const r = (size - stroke) / 2, c = size / 2;
  const clamped = Math.max(0, Math.min(100, percent ?? 0));
  return div().relative().size(size).flex_none()
    .child(window.paint_path(arcPath(c, r, stroke, 0, 359.99), track).absolute().top(0).left(0).size(size))
    .child(window.paint_path(arcPath(c, r, stroke, 0, (clamped / 100) * 360), color).absolute().top(0).left(0).size(size));
}

// Windows: one PowerShell round trip for CPU%, RAM and (if present) GPU.
const WIN_SCRIPT = [
  "$ErrorActionPreference='SilentlyContinue'",
  "$cpu=(Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter \"Name='_Total'\").PercentProcessorTime",
  "$os=Get-CimInstance Win32_OperatingSystem",
  "$gpu=(nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits 2>$null | Select-Object -First 1)",
  "Write-Output \"$cpu|$($os.TotalVisibleMemorySize)|$($os.FreePhysicalMemory)|$gpu\"",
].join("; ");

function parseGpu(part) {
  if (!part) return null;
  const nums = part.split(",").map((n) => parseFloat(n.trim()));
  if (nums.length < 3 || nums.some((n) => Number.isNaN(n))) return null;
  const [util, usedMb, totalMb] = nums;
  return { percent: Math.round(util), usedGb: (usedMb / 1024).toFixed(1), totalGb: (totalMb / 1024).toFixed(1) };
}

function parseWindows(output) {
  const [cpuRaw, totalKb, freeKb, gpuPart] = (output ?? "").trim().split("|");
  const cpuPercent = Number.isFinite(parseFloat(cpuRaw)) ? Math.round(parseFloat(cpuRaw)) : null;
  const total = parseFloat(totalKb) || 0;
  const free = parseFloat(freeKb) || 0;
  const used = Math.max(0, total - free);
  return {
    cpuPercent,
    memPercent: pct(used, total),
    memUsedGb: (used / 1048576).toFixed(1),
    memTotalGb: (total / 1048576).toFixed(0),
    gpu: parseGpu(gpuPart),
  };
}

// Linux (remote machines, or a local non-Windows machine): /proc deltas, as
// a load average alone misreports multi-core usage.
function parseLinux(output, prevCpu) {
  if (!output) return null;
  const parts = output.split("---");
  if (parts.length < 3) return null;
  const [loadPart, statPart, memPart, gpuPart] = parts.map((p) => p.trim());

  const load1m = parseFloat(loadPart.match(/^([\d.]+)/)?.[1] ?? "0");

  let cpuPercent = null, nextCpu = null;
  const fields = statPart.split("\n")[0].trim().split(/\s+/).slice(1).map(Number);
  if (fields.length >= 4) {
    const [user, nice, system, idle, iowait = 0, irq = 0, softirq = 0, steal = 0] = fields;
    const idleTime = idle + iowait, busyTime = user + nice + system + irq + softirq + steal;
    nextCpu = { busy: busyTime, total: idleTime + busyTime };
    if (prevCpu?.total && nextCpu.total > prevCpu.total) {
      const deltaTotal = nextCpu.total - prevCpu.total, deltaBusy = nextCpu.busy - prevCpu.busy;
      cpuPercent = deltaTotal > 0 ? Math.max(0, Math.min(100, Math.round((100 * deltaBusy) / deltaTotal))) : 0;
    }
  }

  const totalKb = parseFloat(memPart.match(/MemTotal:\s+(\d+)\s+kB/i)?.[1] ?? "0");
  let availKb = parseFloat(memPart.match(/MemAvailable:\s+(\d+)\s+kB/i)?.[1] ?? "");
  if (Number.isNaN(availKb)) {
    const free = parseFloat(memPart.match(/MemFree:\s+(\d+)\s+kB/i)?.[1] ?? "0");
    const buf = parseFloat(memPart.match(/Buffers:\s+(\d+)\s+kB/i)?.[1] ?? "0");
    const cache = parseFloat(memPart.match(/Cached:\s+(\d+)\s+kB/i)?.[1] ?? "0");
    availKb = free + buf + cache;
  }
  const usedKb = Math.max(0, totalKb - availKb);

  return {
    cpuPercent,
    load1m,
    memPercent: pct(usedKb, totalKb),
    memUsedGb: (usedKb / 1048576).toFixed(1),
    memTotalGb: (totalKb / 1048576).toFixed(0),
    gpu: parseGpu(gpuPart?.split("\n")[0]),
    nextCpu,
  };
}

export default class NatsuStatus extends View {
  init(_props, cx) {
    this.stats = {};
    this.prevCpu = {};
    this.cachedMachines = [];
    this.lastMachineLs = 0;
    this.polling = {};
    this.manualPolling = new Set(); // keys polled by a click: only those show the spinner
    this.activeTimers = new Set();
    this.refreshAll(cx, true);
    this.mainTimer = cx.timer.every(POLL_MS, (cx) => this.refreshAll(cx, false));
  }

  close() {
    if (this.mainTimer && !this.mainTimer.is_done()) this.mainTimer.cancel();
    for (const t of this.activeTimers) if (t && !t.is_done()) t.cancel();
    this.activeTimers.clear();
  }

  scheduleTimer(ms, handler, cx) {
    const task = cx.timer.after(ms, (cx) => { this.activeTimers.delete(task); handler(cx); });
    this.activeTimers.add(task);
    return task;
  }

  execWithTimeout(cmd, args, options, cx, timeoutMs = TIMEOUT_MS) {
    let timer = null, settled = false;
    return new Promise((resolve, reject) => {
      timer = this.scheduleTimer(timeoutMs, () => { if (!settled) { settled = true; reject(new Error("timeout")); } }, cx);
      exec(cmd, args, options).then((res) => {
        if (settled) return;
        settled = true;
        if (timer && !timer.is_done()) { timer.cancel(); this.activeTimers.delete(timer); }
        resolve(res);
      }).catch((err) => {
        if (settled) return;
        settled = true;
        if (timer && !timer.is_done()) { timer.cancel(); this.activeTimers.delete(timer); }
        reject(err);
      });
    });
  }

  async refreshMachinesList(cx, force = false) {
    const now = Date.now();
    const live = machines().filter((m) => m.name);
    const cachedNames = this.cachedMachines.map((m) => m.name).sort().join(",");
    const liveNames = live.map((m) => m.name).sort().join(",");
    if (!force && this.cachedMachines.length && cachedNames === liveNames && now - this.lastMachineLs < 60000) {
      return this.cachedMachines;
    }
    try {
      const r = await hc(["machine", "ls", "--json"]);
      if (r.code === 0 && r.stdout) {
        const list = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary);
        this.cachedMachines = list;
        this.lastMachineLs = now;
        return list;
      }
    } catch {}
    if (!this.cachedMachines.length) {
      this.cachedMachines = live.map((m) => ({ name: m.name, state: m.layout === "unavailable" ? "disconnected" : "connected" }));
      this.lastMachineLs = now;
    }
    return this.cachedMachines;
  }

  refreshAll(cx, forceList) {
    cx.spawn(async (cx) => {
      const remotes = await this.refreshMachinesList(cx, forceList);
      this.pollMachine({ name: null, display: "This computer" }, cx, false);
      for (const m of remotes) this.pollMachine({ name: m.name, display: m.name, state: m.state }, cx, false);
    });
  }

  key(name) { return name ?? ""; }

  // manual: a click asked for this poll, so it's worth a spinner; the
  // automatic 6s cycle runs quietly, same as the rest of the status bar.
  async pollMachine(target, cx, manual = true) {
    const k = this.key(target.name);
    if (this.polling[k]) return;
    this.polling[k] = true;
    if (manual) this.manualPolling.add(k);
    cx.notify();
    try {
      if (target.state === "disconnected") { this.markOffline(k, cx); return; }
      const local = target.name === null;
      const win = local && appWindow()?.platform === "windows";
      const res = win
        ? await this.execWithTimeout("powershell", ["-NoProfile", "-NonInteractive", "-Command", WIN_SCRIPT], { on: target.name }, cx, LOCAL_TIMEOUT_MS)
        : await this.execWithTimeout("sh", ["-c",
            "cat /proc/loadavg; echo '---'; head -n1 /proc/stat; echo '---'; head -n5 /proc/meminfo; echo '---'; nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits 2>/dev/null || true"],
            { on: target.name }, cx, local ? LOCAL_TIMEOUT_MS : TIMEOUT_MS);
      if (!res || res.code !== 0 || !res.stdout) { this.markOffline(k, cx); return; }
      const parsed = win ? parseWindows(res.stdout) : parseLinux(res.stdout, this.prevCpu[k]);
      if (!parsed) { this.markOffline(k, cx); return; }
      if (parsed.nextCpu) this.prevCpu[k] = parsed.nextCpu;
      this.stats[k] = { online: true, display: target.display, ...parsed };
      cx.notify();
    } catch {
      this.markOffline(k, cx);
    } finally {
      this.polling[k] = false;
      this.manualPolling.delete(k);
      cx.notify();
    }
  }

  markOffline(k, cx) {
    const prev = this.stats[k];
    if (!prev || prev.online !== false) { this.stats[k] = { online: false, display: prev?.display ?? k }; cx.notify(); }
  }

  hint(t) {
    const mac = appWindow()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  render() {
    const t = theme();
    const space = spaces().find((s) => s.active);
    const list = agents();
    const needs = list.filter((a) => a.status === "blocked").length;
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);

    const keysOf = [this.key(null), ...this.cachedMachines.filter((m) => m.name).map((m) => this.key(m.name))];
    const pills = keysOf.map((k) => this.stats[k]).filter(Boolean);

    // Fixed green/yellow/red thresholds, per metric rather than per machine:
    // a maxed-out GPU shouldn't paint an idle CPU's ring amber.
    const metricColor = (value, warnAt, critAt) =>
      value == null ? t.dim : value > critAt ? t.blocked : value > warnAt ? (t.working ?? t.accent) : (t.done ?? t.accent);

    const pill = (k, stat) => {
      const online = stat.online;
      const critical = online && (stat.cpuPercent > 85 || stat.memPercent > 90);
      const warn = online && (stat.cpuPercent > 65 || stat.memPercent > 80);
      const dot = !online ? t.dim : critical ? t.blocked : warn ? (t.working ?? t.accent) : (t.done ?? t.accent);
      const tip = online
        ? `${stat.display}: CPU ${stat.cpuPercent ?? "…"}% · RAM ${stat.memUsedGb}/${stat.memTotalGb} GB (${stat.memPercent}%)`
          + (stat.gpu ? ` · GPU ${stat.gpu.percent}% (${stat.gpu.usedGb}/${stat.gpu.totalGb} GB)` : "")
          + (stat.load1m != null ? ` · load ${stat.load1m}` : "") + " — click to refresh"
        : `${stat.display}: offline — click to retry`;
      // ring + exact % for each metric, each colored by its own green/yellow/red threshold.
      const metric = (value, warnAt, critAt) => {
        const c = metricColor(value, warnAt, critAt);
        return h_flex().gap(3).items_center().child(ring(13, value, c, t.border)).child(div().text_color(c).child(value != null ? `${value}%` : "…"));
      };
      return h_flex()
        .id(`natsu-machine-${k || "local"}`)
        .gap(6).items_center().px(6).py(2).rounded(4)
        .hover((s) => s.bg(t.raised)).cursor_pointer()
        .tooltip(tip)
        .on_click((_e, cx) => {
          if (!online) this.refreshMachinesList(cx, true).then(() => this.pollMachine({ name: k || null, display: stat.display }, cx));
          else this.pollMachine({ name: k || null, display: stat.display }, cx);
        })
        .child(div().size(6).rounded(3).bg(dot))
        .child(div().text_color(t.foreground).child(stat.display))
        .when(this.manualPolling.has(k), (el) => el.child(svg("mods/workspace-chrome/spinner.svg").size(11).flex_none().text_color(t.working ?? t.accent).spin(900)))
        .when(online, (el) => el
          .child(metric(stat.cpuPercent, 65, 85))
          .child(div().text_color(t.dim).child("·"))
          .child(metric(stat.memPercent, 80, 90))
          .when(Boolean(stat.gpu), (e2) => e2.child(div().text_color(t.dim).child("·")).child(metric(stat.gpu.percent, 65, 85))))
        .when(!online, (el) => el.child(div().text_color(t.dim).child("offline")));
    };

    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), (el) => el.child(label("branch", space.branch)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(`${list.length} agents`)
        .when(needs > 0, (el) => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`))))
      .when(pills.length > 0, (el) => el
        .child(div().h(12).w(1).bg(t.border))
        .child(h_flex().gap(8).items_center().children(keysOf.map((k) => [k, this.stats[k]]).filter(([, s]) => s).map(([k, s]) => pill(k, s)))))
      .child(div().flex_1())
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
