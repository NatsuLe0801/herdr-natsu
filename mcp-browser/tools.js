import { z } from "zod";

export const TOOLS = [
  {
    name: "browser_open", cmd: ["open"],
    description: "Navigate to a URL, opening a browser session if needed (agent-browser open)",
    schema: {
      url: z.string().optional(), headed: z.boolean().optional(),
      headers: z.string().optional(), session: z.string().optional(),
    },
    args: [
      { field: "headed", flag: "--headed", kind: "bool" },
      { field: "headers", flag: "--headers", kind: "value" },
      { field: "session", flag: "--session", kind: "value" },
      { field: "url", kind: "positional" },
    ],
  },
  {
    name: "browser_click", cmd: ["click"],
    description: "Click an element (selector or @ref) (agent-browser click)",
    schema: { selector: z.string(), new_tab: z.boolean().optional(), session: z.string().optional() },
    args: [
      { field: "new_tab", flag: "--new-tab", kind: "bool" },
      { field: "session", flag: "--session", kind: "value" },
      { field: "selector", kind: "positional" },
    ],
  },
  {
    name: "browser_dblclick", cmd: ["dblclick"],
    description: "Double-click an element (agent-browser dblclick)",
    schema: { selector: z.string(), session: z.string().optional() },
    args: [
      { field: "session", flag: "--session", kind: "value" },
      { field: "selector", kind: "positional" },
    ],
  },
  {
    name: "browser_type", cmd: ["type"],
    description: "Type text into an element (agent-browser type)",
    schema: { selector: z.string(), text: z.string(), session: z.string().optional() },
    args: [
      { field: "session", flag: "--session", kind: "value" },
      { field: "selector", kind: "positional" },
      { field: "text", kind: "positional" },
    ],
  },
  {
    name: "browser_fill", cmd: ["fill"],
    description: "Clear an element and fill it with text (agent-browser fill)",
    schema: { selector: z.string(), text: z.string(), session: z.string().optional() },
    args: [
      { field: "session", flag: "--session", kind: "value" },
      { field: "selector", kind: "positional" },
      { field: "text", kind: "positional" },
    ],
  },
  {
    name: "browser_press", cmd: ["press"],
    description: "Press a key, e.g. Enter, Tab, Control+a (agent-browser press)",
    schema: { key: z.string(), session: z.string().optional() },
    args: [
      { field: "session", flag: "--session", kind: "value" },
      { field: "key", kind: "positional" },
    ],
  },
  {
    name: "browser_screenshot", cmd: ["screenshot"],
    description: "Take a screenshot of the page or an element (agent-browser screenshot)",
    schema: {
      selector: z.string().optional(), path: z.string().optional(), full: z.boolean().optional(),
      annotate: z.boolean().optional(), format: z.enum(["png", "jpeg"]).optional(),
      quality: z.number().optional(), session: z.string().optional(),
    },
    args: [
      { field: "full", flag: "--full", kind: "bool" },
      { field: "annotate", flag: "--annotate", kind: "bool" },
      { field: "format", flag: "--screenshot-format", kind: "value" },
      { field: "quality", flag: "--screenshot-quality", kind: "value" },
      { field: "session", flag: "--session", kind: "value" },
      { field: "selector", kind: "positional" },
      { field: "path", kind: "positional" },
    ],
  },
  {
    name: "browser_snapshot", cmd: ["snapshot"],
    description: "Get an accessibility-tree snapshot with element refs (@e1, @e2, ...) for use in other tools (agent-browser snapshot)",
    schema: {
      interactive: z.boolean().optional(), urls: z.boolean().optional(), compact: z.boolean().optional(),
      depth: z.number().optional(), selector: z.string().optional(), session: z.string().optional(),
    },
    args: [
      { field: "interactive", flag: "--interactive", kind: "bool" },
      { field: "urls", flag: "--urls", kind: "bool" },
      { field: "compact", flag: "--compact", kind: "bool" },
      { field: "depth", flag: "--depth", kind: "value" },
      { field: "selector", flag: "--selector", kind: "value" },
      { field: "session", flag: "--session", kind: "value" },
    ],
  },
  {
    name: "browser_scroll", cmd: ["scroll"],
    description: "Scroll the page or an element up/down/left/right (agent-browser scroll)",
    schema: {
      direction: z.enum(["up", "down", "left", "right"]).optional(), amount: z.number().optional(),
      selector: z.string().optional(), session: z.string().optional(),
    },
    args: [
      { field: "selector", flag: "--selector", kind: "value" },
      { field: "session", flag: "--session", kind: "value" },
      { field: "direction", kind: "positional" },
      { field: "amount", kind: "positional" },
    ],
  },
  {
    name: "browser_wait", cmd: ["wait"],
    description: "Wait for an element, a timeout, or a page condition (URL, load state, JS expression, text, download) (agent-browser wait)",
    schema: {
      target: z.string().optional(), url: z.string().optional(),
      load: z.enum(["load", "domcontentloaded", "networkidle"]).optional(),
      fn: z.string().optional(), text: z.string().optional(), download: z.string().optional(),
      timeout: z.number().optional(), session: z.string().optional(),
    },
    args: [
      { field: "url", flag: "--url", kind: "value" },
      { field: "load", flag: "--load", kind: "value" },
      { field: "fn", flag: "--fn", kind: "value" },
      { field: "text", flag: "--text", kind: "value" },
      { field: "download", flag: "--download", kind: "value" },
      { field: "timeout", flag: "--timeout", kind: "value" },
      { field: "session", flag: "--session", kind: "value" },
      { field: "target", kind: "positional" },
    ],
  },
  {
    name: "browser_back", cmd: ["back"],
    description: "Go back in browser history (agent-browser back)",
    schema: { session: z.string().optional() },
    args: [{ field: "session", flag: "--session", kind: "value" }],
  },
  {
    name: "browser_forward", cmd: ["forward"],
    description: "Go forward in browser history (agent-browser forward)",
    schema: { session: z.string().optional() },
    args: [{ field: "session", flag: "--session", kind: "value" }],
  },
  {
    name: "browser_reload", cmd: ["reload"],
    description: "Reload the current page (agent-browser reload)",
    schema: { session: z.string().optional() },
    args: [{ field: "session", flag: "--session", kind: "value" }],
  },
  {
    name: "browser_close", cmd: ["close"],
    description: "Close the browser session, or every session with --all (agent-browser close)",
    schema: { all: z.boolean().optional(), session: z.string().optional() },
    args: [
      { field: "all", flag: "--all", kind: "bool" },
      { field: "session", flag: "--session", kind: "value" },
    ],
  },
  {
    name: "browser_get", special: true,
    description: "Retrieve info from the page or an element: text, html, value, attr <name>, title, url, count, box, styles, cdp-url (agent-browser get)",
    schema: {
      subcommand: z.enum(["text", "html", "value", "attr", "title", "url", "count", "box", "styles", "cdp-url"]),
      selector: z.string().optional(), attr_name: z.string().optional(), session: z.string().optional(),
    },
  },
  {
    name: "agent_browser_exec", special: true,
    description: "Run any agent-browser subcommand not covered by the other tools (mouse, network, storage, tabs, diff, debug/trace, streaming, react, performance, SPA, cookies, clipboard); pass the full argv after `agent-browser`, e.g. [\"network\",\"route\",\"*\",\"--abort\"].",
    schema: { args: z.array(z.string()) },
  },
];
