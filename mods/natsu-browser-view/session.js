export function sessionNames(stdout) {
  try {
    const result = JSON.parse(stdout);
    if (result.success !== true || !Array.isArray(result.data?.sessions)) return [];
    return result.data.sessions.filter((name) => typeof name === "string" && name.length > 0);
  } catch {
    return [];
  }
}

export function selectSession(stdout, current = null) {
  const sessions = sessionNames(stdout);
  if (current && sessions.includes(current)) return current;
  return sessions.includes("default") ? "default" : sessions[0] ?? null;
}

export function reconcileSessions(stdout, requested, current, requestedRevision = 0, currentRevision = 0) {
  if (requested !== current || requestedRevision !== currentRevision) return null;
  return { sessions: sessionNames(stdout), session: selectSession(stdout, current) };
}

export function navigationUrl(value) {
  const url = value.trim();
  return url && !url.startsWith("-") ? url : null;
}

export function nextSessionName(sessions) {
  let index = 1;
  while (sessions.includes(`herdr-${index}`)) index += 1;
  return `herdr-${index}`;
}

export function fitImage(containerW, containerH, imageW, imageH) {
  const availableW = Math.max(0, containerW - 32);
  const availableH = Math.max(0, containerH - 32);
  if (!availableW || !availableH || !imageW || !imageH) return { w: 0, h: 0 };
  const scale = Math.min(1, availableW / imageW, availableH / imageH);
  return { w: Math.floor(imageW * scale), h: Math.floor(imageH * scale) };
}

export function pageValue(stdout, key) {
  try {
    const result = JSON.parse(stdout);
    const value = result.success === true ? result.data?.[key] : null;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}
