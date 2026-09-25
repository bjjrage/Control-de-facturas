/** Keep legacy location records readable without exposing the old module name. */
export function displayLocationName(name: string): string {
  return name.normalize("NFC").replace(/\bpa(?:ñ|n)ol(?:es)?\b/gi, (match) =>
    /es$/i.test(match) ? "Depósitos" : "Depósito",
  );
}
