import test from "node:test";
import assert from "node:assert/strict";
import { TOOLS } from "./tools.js";
import { buildArgv } from "./build-argv.js";

test("exactly 25 tools, every name prefixed hc_ and unique", () => {
  assert.equal(TOOLS.length, 25);
  const names = TOOLS.map((t) => t.name);
  assert.equal(new Set(names).size, 25);
  for (const n of names) assert.match(n, /^hc_/);
});

test("every entry has cmd, schema and (args or special)", () => {
  for (const t of TOOLS) {
    assert.ok(Array.isArray(t.cmd) && t.cmd.length > 0, t.name);
    assert.ok(typeof t.schema === "object", t.name);
    assert.ok(Array.isArray(t.args), t.name);
  }
});

test("hc_run builds flags before the trailing argv", () => {
  const def = TOOLS.find((t) => t.name === "hc_run");
  assert.deepEqual(
    buildArgv(def, { bg: true, cwd: "/tmp", argv: ["claude"] }),
    ["run", "--cwd", "/tmp", "--bg", "claude"],
  );
});

test("hc_label builds terminal then the k=v pairs", () => {
  const def = TOOLS.find((t) => t.name === "hc_label");
  assert.deepEqual(buildArgv(def, { terminal: "t7", labels: ["a=1", "b="] }), ["label", "t7", "a=1", "b="]);
});

test("hc_file_edit.validate rejects mismatched old/new lengths", () => {
  const def = TOOLS.find((t) => t.name === "hc_file_edit");
  assert.equal(def.validate({ old: ["a"], new: ["b", "c"] }) !== null, true);
  assert.equal(def.validate({ old: ["a"], new: ["b"] }), null);
});

test("hc_machine_rename builds machine then new_name", () => {
  const def = TOOLS.find((t) => t.name === "hc_machine_rename");
  assert.deepEqual(buildArgv(def, { machine: "vps", new_name: "prod" }), ["machine", "rename", "vps", "prod"]);
});
