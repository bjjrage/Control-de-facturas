import type { StoredWorkingSnapshot } from "./snapshot-storage";
import type { WorkingSnapshot } from "./workbook-store";

/** Decode the compact transport in the browser; never ship node:zlib there. */
export async function decodeBrowserSnapshot(stored: StoredWorkingSnapshot): Promise<WorkingSnapshot> {
  if (!("encoding" in stored)) return stored;
  if (stored.encoding !== "gzip-base64-v1") throw new Error("Formato de fuente desconocido.");
  const bytes = Uint8Array.from(atob(stored.data), c => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).json() as Promise<WorkingSnapshot>;
}
