export function buildArgv(def, input) {
  const argv = [...def.cmd];
  for (const a of def.args) {
    const v = input[a.field];
    if (v === undefined || v === null || v === false) continue;
    if (a.kind === "bool") argv.push(a.flag);
    else if (a.kind === "value") argv.push(a.flag, String(v));
    else if (a.kind === "repeat") for (const item of v) argv.push(a.flag, String(item));
    else if (a.kind === "positional") argv.push(String(v));
    else if (a.kind === "positionalArray") for (const item of v) argv.push(String(item));
    else throw new Error(`buildArgv: unknown arg kind "${a.kind}"`);
  }
  return argv;
}
