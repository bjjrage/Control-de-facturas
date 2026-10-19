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

export function inspectWarehousePortalFile(name: string, type: string, bytes: Uint8Array, _allowSheets: boolean):
  { ok: boolean; contentType?: string; error?: string } {
  const extension = name.toLowerCase().split(".").pop() ?? "";
  const textPrefix = (length: number) => new TextDecoder().decode(bytes.subarray(0, length));
  const begins = (signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  const imageOrPdf: Record<string, { mime: string; signed: boolean }> = {
    pdf: { mime: "application/pdf", signed: textPrefix(5) === "%PDF-" },
    jpg: { mime: "image/jpeg", signed: begins([0xff, 0xd8, 0xff]) },
    jpeg: { mime: "image/jpeg", signed: begins([0xff, 0xd8, 0xff]) },
    png: { mime: "image/png", signed: begins([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
    webp: { mime: "image/webp", signed: textPrefix(4) === "RIFF" && new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP" },
    heic: { mime: "image/heic", signed: new TextDecoder().decode(bytes.subarray(4, 8)) === "ftyp" && ["heic", "heix", "hevc", "hevx"].includes(new TextDecoder().decode(bytes.subarray(8, 12))) },
  };
  // Keep this list aligned with warehouse-evidence.allowed_mime_types.
  const format = imageOrPdf[extension];
  const declared = type.toLowerCase();
  const compatibleType = !declared || declared === format?.mime || declared === "application/octet-stream";
  if (!format || !format.signed || !compatibleType) {
    return { ok: false, error: `${name}: tipo o contenido de archivo no permitido.` };
  }
  return { ok: true, contentType: format.mime };
}

