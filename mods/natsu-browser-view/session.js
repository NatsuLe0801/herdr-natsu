export function selectSession(stdout) {
  try {
    const result = JSON.parse(stdout);
    if (result.success !== true || !Array.isArray(result.data?.sessions)) return null;
    const sessions = result.data.sessions.filter((name) => typeof name === "string" && name.length > 0);
    // Preserve the existing default-session flow; otherwise follow CLI order.
    return sessions.includes("default") ? "default" : sessions[0] ?? null;
  } catch {
    return null;
  }
}
