import test from "node:test";
import assert from "node:assert/strict";
import { selectSession } from "./session.js";

test("selectSession returns null when no active session exists", () => {
  assert.equal(selectSession('{"success":true,"data":{"sessions":[]}}'), null);
});

test("selectSession selects the default session when it is the only session", () => {
  assert.equal(selectSession('{"success":true,"data":{"sessions":["default"]}}'), "default");
});

test("selectSession selects the first returned named session when default is absent", () => {
  assert.equal(selectSession('{"success":true,"data":{"sessions":["s1","s2"]}}'), "s1");
});

test("selectSession prefers default over named sessions regardless of returned position", () => {
  assert.equal(selectSession('{"success":true,"data":{"sessions":["s1","default"]}}'), "default");
});

test("selectSession rejects unsuccessful or malformed output", () => {
  assert.equal(selectSession('{"success":false,"data":{"sessions":["s1"]}}'), null);
  assert.equal(selectSession("not json"), null);
});
