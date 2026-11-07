import test from "node:test";
import assert from "node:assert/strict";
import { sectionState } from "./state.js";
import * as stateHelpers from "./state.js";

const section = (overrides = {}) => ({
  checks: [{ key: "binary" }],
  depsCheck: { path: "node_modules/zod/package.json" },
  installSteps: [{ when: "depsReady", expected: false, id: "deps" }],
  prepRepairsChecks: false,
  ...overrides,
});

const status = (overrides = {}) => ({
  binary: true,
  depsReady: true,
  registered: false,
  ...overrides,
});

test("sectionState keeps incomplete checks neutral and actionless", () => {
  assert.deepEqual(sectionState(section(), {}), {
    checking: true,
    checksReady: false,
    depsReady: false,
    ready: false,
    pill: { label: "Checking…", tone: "neutral" },
    actions: [],
    shouldPrep: false,
  });
});

test("sectionState shows install for an unregistered ready section", () => {
  assert.deepEqual(sectionState(section(), status()).pill, { label: "Not connected", tone: "blocked" });
  assert.deepEqual(sectionState(section(), status()).actions, ["install"]);
  assert.equal(sectionState(section(), status()).shouldPrep, false);
});

test("sectionState shows activated without a destructive action", () => {
  const state = sectionState(section(), status({ registered: true }));
  assert.deepEqual(state.pill, { label: "Activated", tone: "ready" });
  assert.deepEqual(state.actions, []);
});

test("sectionState repairs registered local dependencies without remove", () => {
  const state = sectionState(section(), status({ depsReady: false, registered: true }));
  assert.deepEqual(state.pill, { label: "Registered · needs repair", tone: "blocked" });
  assert.deepEqual(state.actions, ["repair"]);
  assert.equal(state.shouldPrep, true);
});

test("sectionState withholds install when prep cannot repair a missing external check", () => {
  const state = sectionState(section(), status({ binary: false }));
  assert.deepEqual(state.actions, []);
  assert.equal(state.shouldPrep, false);
});

test("sectionState offers install when prep can repair a missing external check", () => {
  const state = sectionState(section({ depsCheck: null, prepRepairsChecks: true, installSteps: [{ when: "binary", expected: false, id: "binary" }] }), status({ binary: false }));
  assert.deepEqual(state.actions, ["install"]);
  assert.equal(state.shouldPrep, true);
});

test("sectionState offers repair only for a stale repairable registration", () => {
  const state = sectionState(
    section({ depsCheck: null, prepRepairsChecks: true, installSteps: [{ when: "binary", expected: false, id: "binary" }] }),
    status({ binary: false, registered: true }),
  );
  assert.deepEqual(state.pill, { label: "Registered · needs repair", tone: "blocked" });
  assert.deepEqual(state.actions, ["repair"]);
  assert.equal(state.shouldPrep, true);
});

test("installSteps prepares a missing browser CLI, runtime, and local dependencies in order", () => {
  assert.equal(typeof stateHelpers.installSteps, "function");
  const steps = stateHelpers.installSteps({
    installSteps: [
      { when: "agentBrowser", expected: false, id: "cli" },
      { when: "browserRuntime", expected: false, id: "runtime" },
      { when: "depsReady", expected: false, id: "deps" },
      { when: "registered", expected: false, id: "register" },
    ],
  }, { agentBrowser: false, browserRuntime: false, depsReady: false, registered: false });
  assert.deepEqual(steps.map((step) => step.id), ["cli", "runtime", "deps", "register"]);
});

test("installResult accepts only the current install token", () => {
  assert.equal(typeof stateHelpers.installResult, "function");
  assert.equal(stateHelpers.installResult('{"token":"old","state":"error","error":"old failure"}', "new"), null);
  assert.deepEqual(stateHelpers.installResult('{"token":"new","state":"error","error":"network failed"}', "new"), {
    state: "error",
    error: "network failed",
  });
  assert.deepEqual(stateHelpers.installResult('{"token":"new","state":"done"}', "new"), { state: "done" });
});

test("installSteps skips preparation that is already healthy", () => {
  assert.deepEqual(stateHelpers.installSteps({
    installSteps: [
      { when: "agentBrowser", expected: false, id: "cli" },
      { when: "browserRuntime", expected: false, id: "runtime" },
      { when: "depsReady", expected: false, id: "deps" },
      { when: "registered", expected: false, id: "register" },
    ],
  }, { agentBrowser: true, browserRuntime: true, depsReady: true, registered: true }), []);
});
