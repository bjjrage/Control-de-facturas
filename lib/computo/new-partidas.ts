// Códigos para partidas creadas desde el cómputo métrico o el BIM. Prefijo
// propio (CM-001, CM-002…) para no pisar la numeración del presupuesto que
// venga después; nunca repite un código que ya exista en la obra.
export function nextPartidaCodes(existingCodes: string[], count: number, prefix = "CM-"): string[] {
  const taken = new Set(existingCodes.map((c) => c.trim()));
  let n = 0;
  for (const c of taken) {
    if (!c.startsWith(prefix)) continue;
    const num = Number(c.slice(prefix.length));
    if (Number.isInteger(num) && num > n) n = num;
  }
  const out: string[] = [];
  while (out.length < count) {
    n++;
    const code = `${prefix}${String(n).padStart(3, "0")}`;
    if (!taken.has(code)) out.push(code);
  }
  return out;
}
