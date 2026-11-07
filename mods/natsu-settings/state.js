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

  const canRepair = Boolean(section.prepCmd) && !ready && (checksReady || section.prepRepairsChecks);
  const actions = status.registered
    ? [...(canRepair ? ["repair"] : []), "remove"]
    : ready || canRepair ? ["install"] : [];
  const pill = status.registered
    ? ready
      ? { label: "Activated", tone: "ready" }
      : { label: "Registered · needs repair", tone: "blocked" }
    : { label: "Not connected", tone: "blocked" };

  return {
    checking, checksReady, depsReady, ready, pill, actions,
    shouldPrep: canRepair && (!section.skipPrepWhenDepsReady || !depsReady),
  };
}
