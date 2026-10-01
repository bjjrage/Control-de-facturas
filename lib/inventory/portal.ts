import { createHash, randomBytes } from "node:crypto";

export function enforceWarehousePortalFileLimit<T>(files: readonly T[], maxFiles: number):
  | { allowed: true; files: T[] }
  | { allowed: false; files: [] } {
  if (files.length > maxFiles) return { allowed: false, files: [] };
  return { allowed: true, files: [...files] };
}

export function hashWarehousePortalToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateWarehousePortalToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashWarehousePortalToken(token), tokenHint: token.slice(-6) };
}

export function warehousePortalUrl(token: string, origin = process.env.NEXT_PUBLIC_APP_URL ?? "") {
  return `${origin.replace(/\/$/, "")}/warehouse/${encodeURIComponent(token)}`;
}

export function sha256Bytes(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
