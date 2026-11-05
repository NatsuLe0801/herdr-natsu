import { z } from "zod";

export const TOOLS = [
  {
    name: "hc_run", cmd: ["run"],
    description: "Start a program, or a template by name with its task, in a new terminal (hc run)",
    schema: {
      argv: z.array(z.string()).optional(), name: z.string().optional(), cwd: z.string().optional(),
      on: z.string().optional(), label: z.array(z.string()).optional(), parent: z.string().optional(),
      no_parent: z.boolean().optional(), no_notify: z.boolean().optional(), outlive_parent: z.boolean().optional(),
      rm: z.boolean().optional(), keep: z.boolean().optional(), bg: z.boolean().optional(), timeout: z.number().optional(),
    },
    args: [
      { field: "name", flag: "--name", kind: "value" },
      { field: "cwd", flag: "--cwd", kind: "value" },
      { field: "on", flag: "--on", kind: "value" },
      { field: "label", flag: "--label", kind: "repeat" },
      { field: "parent", flag: "--parent", kind: "value" },
      { field: "no_parent", flag: "--no-parent", kind: "bool" },
      { field: "no_notify", flag: "--no-notify", kind: "bool" },
      { field: "outlive_parent", flag: "--outlive-parent", kind: "bool" },
      { field: "rm", flag: "--rm", kind: "bool" },
      { field: "keep", flag: "--keep", kind: "bool" },
      { field: "bg", flag: "--bg", kind: "bool" },
      { field: "timeout", flag: "--timeout", kind: "value" },
      { field: "argv", kind: "positionalArray" },
    ],
  },
  {
    name: "hc_ls", cmd: ["ls"], description: "List live terminals (hc ls)",
    schema: { all: z.boolean().optional(), label: z.array(z.string()).optional() },
    args: [{ field: "all", flag: "--all", kind: "bool" }, { field: "label", flag: "--label", kind: "repeat" }],
  },
  {
    name: "hc_get", cmd: ["get"], description: "Show one terminal (hc get)",
    schema: { terminal: z.string() }, args: [{ field: "terminal", kind: "positional" }],
  },
  {
    name: "hc_read", cmd: ["read"], description: "Print a terminal's screen and history (hc read)",
    schema: { terminal: z.string(), lines: z.number().optional() },
    args: [{ field: "lines", flag: "--lines", kind: "value" }, { field: "terminal", kind: "positional" }],
  },
  {
    name: "hc_kill", cmd: ["kill"], description: "End a terminal's program: hangup, then escalate (hc kill)",
    schema: { terminal: z.string() }, args: [{ field: "terminal", kind: "positional" }],
  },
  {
    name: "hc_rm", cmd: ["rm"], description: "Remove a finished terminal (hc rm)",
    schema: { terminal: z.string() }, args: [{ field: "terminal", kind: "positional" }],
  },
  {
    name: "hc_label", cmd: ["label"], description: "Set labels on a terminal; key= removes one (hc label)",
    schema: { terminal: z.string(), labels: z.array(z.string()).min(1) },
    args: [{ field: "terminal", kind: "positional" }, { field: "labels", kind: "positionalArray" }],
  },
  {
    name: "hc_keep", cmd: ["keep"], description: "Keep a live terminal after loss, or stop with off (hc keep)",
    schema: { terminal: z.string(), off: z.boolean().optional() },
    args: [{ field: "off", flag: "--off", kind: "bool" }, { field: "terminal", kind: "positional" }],
  },
  {
    name: "hc_send", cmd: ["send"], description: "Paste text into a terminal and press Enter (hc send)",
    schema: {
      terminal: z.string(), text: z.string(), force: z.boolean().optional(),
      if: z.enum(["idle", "working"]).optional(), wait: z.boolean().optional(), timeout: z.number().optional(),
    },
    args: [
      { field: "force", flag: "--force", kind: "bool" },
      { field: "if", flag: "--if", kind: "value" },
      { field: "wait", flag: "--wait", kind: "bool" },
      { field: "timeout", flag: "--timeout", kind: "value" },
      { field: "terminal", kind: "positional" },
      { field: "text", kind: "positional" },
    ],
  },
  {
    name: "hc_keys", cmd: ["keys"], description: "Press named keys: enter, esc, up, ctrl+c, ... (hc keys)",
    schema: { terminal: z.string(), keys: z.array(z.string()).min(1) },
    args: [{ field: "terminal", kind: "positional" }, { field: "keys", kind: "positionalArray" }],
  },
  {
    name: "hc_interrupt", cmd: ["interrupt"], description: "Press the stop key and report what happened (hc interrupt)",
    schema: { terminal: z.string(), timeout: z.number().optional() },
    args: [{ field: "timeout", flag: "--timeout", kind: "value" }, { field: "terminal", kind: "positional" }],
  },
  {
    name: "hc_wait", cmd: ["wait"], description: "Wait until a terminal stops working, or for its children (hc wait)",
    schema: {
      terminal: z.string().optional(), children: z.enum(["any", "all"]).optional(),
      output: z.string().optional(), timeout: z.number().optional(),
    },
    args: [
      { field: "children", flag: "--children", kind: "value" },
      { field: "output", flag: "--output", kind: "value" },
      { field: "timeout", flag: "--timeout", kind: "value" },
      { field: "terminal", kind: "positional" },
    ],
  },
  {
    name: "hc_put", cmd: ["put"], description: "Send a local file beside a terminal, on its machine (hc put)",
    schema: { terminal: z.string(), file: z.string() },
    args: [{ field: "terminal", kind: "positional" }, { field: "file", kind: "positional" }],
  },
  {
    name: "hc_exec", cmd: ["exec"], special: true,
    description: "Run one program without a terminal, here or on a machine (hc exec)",
    schema: {
      argv: z.array(z.string()).min(1), on: z.string().optional(), cwd: z.string().optional(),
      env: z.array(z.string()).optional(), timeout: z.number().optional(), stdin: z.string().optional(),
    },
    args: [
      { field: "on", flag: "--on", kind: "value" },
      { field: "cwd", flag: "--cwd", kind: "value" },
      { field: "env", flag: "--env", kind: "repeat" },
      { field: "timeout", flag: "--timeout", kind: "value" },
    ],
  },
  {
    name: "hc_file_read", cmd: ["file", "read"], description: "Print a text file, here or on a machine (hc file read)",
    schema: {
      path: z.string(), on: z.string().optional(), cwd: z.string().optional(),
      offset: z.number().optional(), limit: z.number().optional(),
    },
    args: [
      { field: "on", flag: "--on", kind: "value" },
      { field: "cwd", flag: "--cwd", kind: "value" },
      { field: "offset", flag: "--offset", kind: "value" },
      { field: "limit", flag: "--limit", kind: "value" },
      { field: "path", kind: "positional" },
    ],
  },
  {
    name: "hc_file_write", cmd: ["file", "write"], special: true,
    description: "Write content as a file, here or on a machine, making missing folders (hc file write)",
    schema: { path: z.string(), content: z.string(), on: z.string().optional(), cwd: z.string().optional() },
    args: [
      { field: "on", flag: "--on", kind: "value" },
      { field: "cwd", flag: "--cwd", kind: "value" },
      { field: "path", kind: "positional" },
    ],
  },
  {
    name: "hc_file_edit", cmd: ["file", "edit"],
    description: "Replace exact text found once in a file, here or on a machine; all or none (hc file edit)",
    schema: {
      path: z.string(), on: z.string().optional(), cwd: z.string().optional(),
      old: z.array(z.string()).min(1), new: z.array(z.string()).min(1),
    },
    args: [
      { field: "on", flag: "--on", kind: "value" },
      { field: "cwd", flag: "--cwd", kind: "value" },
      { field: "old", flag: "--old", kind: "repeat" },
      { field: "new", flag: "--new", kind: "repeat" },
      { field: "path", kind: "positional" },
    ],
    validate: (input) => (input.old.length === input.new.length ? null : "old and new must have the same length"),
  },
  {
    name: "hc_templates", cmd: ["templates"], description: "List templates runnable by name (hc templates)",
    schema: {}, args: [],
  },
  {
    name: "hc_events", cmd: ["events"], special: true,
    description: "Poll fact changes for a short window instead of streaming forever (hc events)",
    schema: {
      terminal: z.string().optional(), children_of: z.string().optional(),
      label: z.array(z.string()).optional(), wait_ms: z.number().optional(),
    },
    args: [
      { field: "terminal", flag: "--terminal", kind: "value" },
      { field: "children_of", flag: "--children-of", kind: "value" },
      { field: "label", flag: "--label", kind: "repeat" },
    ],
  },
  {
    name: "hc_machine_ls", cmd: ["machine", "ls"], description: "List the machines added here (hc machine ls)",
    schema: {}, args: [],
  },
  {
    name: "hc_machine_add", cmd: ["machine", "add"],
    description: "Add a machine reached over ssh (hc machine add). Warning: if the host needs a password or interactive confirmation, this call has no terminal to answer it and may hang until its own timeout.",
    schema: {
      target: z.string().optional(), via: z.string().optional(), temp: z.boolean().optional(),
      install: z.boolean().optional(), name: z.string().optional(), session: z.string().optional(),
    },
    args: [
      { field: "via", flag: "--via", kind: "value" },
      { field: "temp", flag: "--temp", kind: "bool" },
      { field: "install", flag: "--install", kind: "bool" },
      { field: "name", flag: "--name", kind: "value" },
      { field: "session", flag: "--session", kind: "value" },
      { field: "target", kind: "positional" },
    ],
  },
  {
    name: "hc_machine_login", cmd: ["machine", "login"],
    description: "Log in again on a machine that says it needs it (hc machine login). Warning: if it prompts for a password or code, this call has no terminal to answer it and may hang until its own timeout.",
    schema: { machine: z.string() }, args: [{ field: "machine", kind: "positional" }],
  },
  {
    name: "hc_machine_update", cmd: ["machine", "update"],
    description: "Copy this hc to a machine and restart it there (hc machine update)",
    schema: { machine: z.string() }, args: [{ field: "machine", kind: "positional" }],
  },
  {
    name: "hc_machine_rename", cmd: ["machine", "rename"], description: "Give a machine a new name here (hc machine rename)",
    schema: { machine: z.string(), new_name: z.string() },
    args: [{ field: "machine", kind: "positional" }, { field: "new_name", kind: "positional" }],
  },
  {
    name: "hc_machine_rm", cmd: ["machine", "rm"], description: "Forget a machine; its terminals keep running there (hc machine rm)",
    schema: { machine: z.string() }, args: [{ field: "machine", kind: "positional" }],
  },
];
