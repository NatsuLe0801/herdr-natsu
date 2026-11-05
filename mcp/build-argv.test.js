import test from "node:test";
import assert from "node:assert/strict";
import { buildArgv } from "./build-argv.js";

test("bool: flag appears only when the field is truthy", () => {
  const def = { cmd: ["ls"], args: [{ field: "all", flag: "--all", kind: "bool" }] };
  assert.deepEqual(buildArgv(def, { all: true }), ["ls", "--all"]);
  assert.deepEqual(buildArgv(def, { all: false }), ["ls"]);
  assert.deepEqual(buildArgv(def, {}), ["ls"]);
});

test("value: flag plus stringified value when present", () => {
  const def = { cmd: ["read"], args: [{ field: "lines", flag: "--lines", kind: "value" }] };
  assert.deepEqual(buildArgv(def, { lines: 20 }), ["read", "--lines", "20"]);
  assert.deepEqual(buildArgv(def, {}), ["read"]);
});

test("repeat: flag repeated once per array element", () => {
  const def = { cmd: ["ls"], args: [{ field: "label", flag: "--label", kind: "repeat" }] };
  assert.deepEqual(buildArgv(def, { label: ["a=1", "b=2"] }), ["ls", "--label", "a=1", "--label", "b=2"]);
  assert.deepEqual(buildArgv(def, {}), ["ls"]);
});

test("positional and positionalArray append raw values after flags", () => {
  const def = {
    cmd: ["label"],
    args: [{ field: "terminal", kind: "positional" }, { field: "pairs", kind: "positionalArray" }],
  };
  assert.deepEqual(buildArgv(def, { terminal: "t7", pairs: ["a=1", "b="] }), ["label", "t7", "a=1", "b="]);
});

test("matches the real hc_send shape: flags before positionals, in --help order", () => {
  const def = {
    cmd: ["send"],
    args: [
      { field: "force", flag: "--force", kind: "bool" },
      { field: "if", flag: "--if", kind: "value" },
      { field: "wait", flag: "--wait", kind: "bool" },
      { field: "timeout", flag: "--timeout", kind: "value" },
      { field: "terminal", kind: "positional" },
      { field: "text", kind: "positional" },
    ],
  };
  assert.deepEqual(buildArgv(def, { terminal: "t7", text: "hi" }), ["send", "t7", "hi"]);
  assert.deepEqual(
    buildArgv(def, { terminal: "t7", text: "hi", force: true, wait: true, timeout: 30 }),
    ["send", "--force", "--wait", "--timeout", "30", "t7", "hi"],
  );
});
