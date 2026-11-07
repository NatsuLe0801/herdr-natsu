export function installSteps(section, status = {}) {
  return (section.installSteps ?? []).filter((step) => !step.when || status[step.when] === step.expected);
}

export function installResult(raw, token) {
  try {
    const result = JSON.parse(raw);
    if (result.token !== token || !["running", "done", "error"].includes(result.state)) return null;
    return result.state === "error"
      ? { state: "error", error: String(result.error ?? "Install failed") }
      : { state: result.state };
  } catch {
    return null;
  }
}

export function sectionState(section, status = {}) {
  const checksReady = section.checks.every((check) => status[check.key] === true);
  const depsReady = !section.depsCheck || status.depsReady === true;
  const ready = checksReady && depsReady;
  const checking = status.registered == null
    || section.checks.some((check) => status[check.key] == null)
    || Boolean(section.depsCheck && status.depsReady == null);

  if (checking) {
    return {
      checking, checksReady, depsReady, ready,
      pill: { label: "Checking…", tone: "neutral" },
      actions: [],
      shouldPrep: false,
    };
  }

  const canRepair = Boolean(section.installSteps?.length) && !ready && (checksReady || section.prepRepairsChecks);
  const actions = status.registered
    ? canRepair ? ["repair"] : []
    : ready || canRepair ? ["install"] : [];
  const pill = status.registered
    ? ready
      ? { label: "Activated", tone: "ready" }
      : { label: "Registered · needs repair", tone: "blocked" }
    : { label: "Not connected", tone: "blocked" };

  return {
    checking, checksReady, depsReady, ready, pill, actions,
    shouldPrep: installSteps(section, status).length > 0,
  };
}
