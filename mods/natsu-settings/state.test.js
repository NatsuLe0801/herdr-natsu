import test from "node:test";
import assert from "node:assert/strict";
import { sectionState } from "./state.js";

const section = (overrides = {}) => ({
  checks: [{ key: "binary" }],
  depsCheck: { path: "node_modules/zod/package.json" },
  prepCmd: { bin: "npm", args: ["install"] },
  prepRepairsChecks: false,
  skipPrepWhenDepsReady: true,
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

test("sectionState shows activated and remove only when registered and ready", () => {
  const state = sectionState(section(), status({ registered: true }));
  assert.deepEqual(state.pill, { label: "Activated", tone: "ready" });
  assert.deepEqual(state.actions, ["remove"]);
});

test("sectionState repairs registered local dependencies and keeps remove", () => {
  const state = sectionState(section(), status({ depsReady: false, registered: true }));
  assert.deepEqual(state.pill, { label: "Registered · needs repair", tone: "blocked" });
  assert.deepEqual(state.actions, ["repair", "remove"]);
  assert.equal(state.shouldPrep, true);
});

test("sectionState withholds install when prep cannot repair a missing external check", () => {
  const state = sectionState(section(), status({ binary: false }));
  assert.deepEqual(state.actions, []);
  assert.equal(state.shouldPrep, false);
});

test("sectionState offers install when prep can repair a missing external check", () => {
  const state = sectionState(section({ depsCheck: null, prepRepairsChecks: true, skipPrepWhenDepsReady: false }), status({ binary: false }));
  assert.deepEqual(state.actions, ["install"]);
  assert.equal(state.shouldPrep, true);
});

test("sectionState offers repair and remove for a stale repairable registration", () => {
  const state = sectionState(
    section({ depsCheck: null, prepRepairsChecks: true, skipPrepWhenDepsReady: false }),
    status({ binary: false, registered: true }),
  );
  assert.deepEqual(state.pill, { label: "Registered · needs repair", tone: "blocked" });
  assert.deepEqual(state.actions, ["repair", "remove"]);
  assert.equal(state.shouldPrep, true);
});
