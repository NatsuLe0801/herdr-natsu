import test from "node:test";
import assert from "node:assert/strict";
import { selectSession } from "./session.js";
import * as session from "./session.js";

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

test("selectSession keeps the user's current session while it still exists", () => {
  assert.equal(selectSession('{"success":true,"data":{"sessions":["default","agent-2"]}}', "agent-2"), "agent-2");
});

test("sessionNames returns the validated CLI session order", () => {
  assert.equal(typeof session.sessionNames, "function");
  assert.deepEqual(session.sessionNames('{"success":true,"data":{"sessions":["agent-2",null,"","default"]}}'), ["agent-2", "default"]);
});

test("nextSessionName fills the first available Herdr session number", () => {
  assert.equal(typeof session.nextSessionName, "function");
  assert.equal(session.nextSessionName(["default", "herdr-1", "agent-2", "herdr-3"]), "herdr-2");
});

test("pageValue reads successful agent-browser get JSON", () => {
  assert.equal(typeof session.pageValue, "function");
  assert.equal(session.pageValue('{"success":true,"data":{"url":"https://example.com/"}}', "url"), "https://example.com/");
  assert.equal(session.pageValue('{"success":true,"data":{"title":"Example Domain"}}', "title"), "Example Domain");
  assert.equal(session.pageValue("not json", "url"), null);
});

test("reconcileSessions discards a refresh for a tab that is no longer selected", () => {
  assert.equal(typeof session.reconcileSessions, "function");
  const stdout = '{"success":true,"data":{"sessions":["herdr-1","herdr-2"]}}';
  assert.equal(session.reconcileSessions(stdout, "herdr-1", "herdr-2"), null);
  assert.deepEqual(session.reconcileSessions(stdout, "herdr-2", "herdr-2"), {
    sessions: ["herdr-1", "herdr-2"],
    session: "herdr-2",
  });
});

test("reconcileSessions discards a refresh invalidated by an action", () => {
  const stdout = '{"success":true,"data":{"sessions":["herdr-1"]}}';
  assert.equal(session.reconcileSessions(stdout, "herdr-1", "herdr-1", 2, 3), null);
});

test("navigationUrl rejects input that agent-browser would parse as an option", () => {
  assert.equal(typeof session.navigationUrl, "function");
  assert.equal(session.navigationUrl("  https://example.com  "), "https://example.com");
  assert.equal(session.navigationUrl("--version"), null);
  assert.equal(session.navigationUrl("   "), null);
});

test("syncUrlDraft never overwrites an unsubmitted URL", () => {
  assert.equal(typeof session.syncUrlDraft, "function");
  assert.equal(session.syncUrlDraft("https://example.com", "about:blank", true), "https://example.com");
  assert.equal(session.syncUrlDraft("https://example.com", "https://iana.org/", false), "https://iana.org/");
});

test("shouldTrackUrlChange depends only on internal syncing", () => {
  assert.equal(typeof session.shouldTrackUrlChange, "function");
  assert.equal(session.shouldTrackUrlChange(false), true);
  assert.equal(session.shouldTrackUrlChange(true), false);
});
