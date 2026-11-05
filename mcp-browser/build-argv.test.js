import test from "node:test";
import assert from "node:assert/strict";
import { buildArgv } from "./build-argv.js";

test("bool: flag appears only when the field is truthy", () => {
  const def = { cmd: ["snapshot"], args: [{ field: "interactive", flag: "--interactive", kind: "bool" }] };
  assert.deepEqual(buildArgv(def, { interactive: true }), ["snapshot", "--interactive"]);
  assert.deepEqual(buildArgv(def, { interactive: false }), ["snapshot"]);
  assert.deepEqual(buildArgv(def, {}), ["snapshot"]);
});

test("value: flag plus stringified value when present", () => {
  const def = { cmd: ["screenshot"], args: [{ field: "quality", flag: "--quality", kind: "value" }] };
  assert.deepEqual(buildArgv(def, { quality: 80 }), ["screenshot", "--quality", "80"]);
  assert.deepEqual(buildArgv(def, {}), ["screenshot"]);
});

test("repeat: flag repeated once per array element", () => {
  const def = { cmd: ["screenshot"], args: [{ field: "tag", flag: "--tag", kind: "repeat" }] };
  assert.deepEqual(buildArgv(def, { tag: ["a=1", "b=2"] }), ["screenshot", "--tag", "a=1", "--tag", "b=2"]);
  assert.deepEqual(buildArgv(def, {}), ["screenshot"]);
});

test("positional and positionalArray append raw values after flags", () => {
  const def = {
    cmd: ["type"],
    args: [{ field: "selector", kind: "positional" }, { field: "keys", kind: "positionalArray" }],
  };
  assert.deepEqual(buildArgv(def, { selector: "#input", keys: ["a", "b"] }), ["type", "#input", "a", "b"]);
});

test("matches a real tool's shape: flags before positionals, in --help order", () => {
  const def = {
    cmd: ["click"],
    args: [
      { field: "new_tab", flag: "--new-tab", kind: "bool" },
      { field: "session", flag: "--session", kind: "value" },
      { field: "selector", kind: "positional" },
    ],
  };
  assert.deepEqual(buildArgv(def, { selector: "#btn" }), ["click", "#btn"]);
  assert.deepEqual(
    buildArgv(def, { selector: "#btn", new_tab: true, session: "s1" }),
    ["click", "--new-tab", "--session", "s1", "#btn"],
  );
});
