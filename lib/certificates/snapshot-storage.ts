import { gzipSync, gunzipSync } from "node:zlib";
import type { WorkingSnapshot } from "./workbook-store";

type CompressedSnapshot = { encoding: "gzip-base64-v1"; data: string };
export type StoredWorkingSnapshot = WorkingSnapshot | CompressedSnapshot;

// XLSX is already compressed; its editable JSON can be much larger. Keep
// large payloads compact across PostgREST, including subsequent autosaves.
export function encodeSnapshot(snapshot: WorkingSnapshot): StoredWorkingSnapshot {
  const json = JSON.stringify(snapshot);
  if (Buffer.byteLength(json) < 256 * 1024) return snapshot;
  const compressed: CompressedSnapshot = {
    encoding: "gzip-base64-v1",
    data: gzipSync(json).toString("base64"),
  };
  return compressed.data.length < Buffer.byteLength(json) ? compressed : snapshot;
}

export function decodeSnapshot(stored: StoredWorkingSnapshot): WorkingSnapshot {
  if (!("encoding" in stored)) return stored;
  if (stored.encoding !== "gzip-base64-v1") throw new Error("Formato de copia de trabajo desconocido.");
  const snapshot = JSON.parse(gunzipSync(Buffer.from(stored.data, "base64"), {
    maxOutputLength: 128 * 1024 * 1024,
  }).toString("utf8")) as WorkingSnapshot;
  if (!snapshot || !Array.isArray(snapshot.sheets) || typeof snapshot.fileName !== "string") {
    throw new Error("La copia de trabajo guardada no es válida.");
  }
  return snapshot;
}
