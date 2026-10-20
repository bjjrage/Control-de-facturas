export const DOCUMENT_UPLOAD_BUCKET = "direct-document-uploads";
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const MAX_DOCUMENT_BATCH_BYTES = 50 * 1024 * 1024;
export const DOCUMENT_REFERENCE_PREFIX = "direct-upload:v1:";
export const DOCUMENT_MIME_TYPES = [
  "application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic",
  "application/octet-stream",
];
export type DocumentUploadContext =
  | { kind: "internal" }
  | { kind: "warehouse" | "receipt"; token: string }
  | { kind: "scanner"; mobileClaimToken?: string };
export type DocumentMetadata = { name: string; type: string; size: number; sha256: string };
export function validDocumentMetadata(value: unknown): value is DocumentMetadata {
  if (!value || typeof value !== "object") return false;
  const m = value as DocumentMetadata;
  return typeof m.name === "string" && m.name.length > 0 && m.name.length <= 255
    && DOCUMENT_MIME_TYPES.includes(m.type) && Number.isSafeInteger(m.size)
    && m.size > 0 && m.size <= MAX_DOCUMENT_BYTES && typeof m.sha256 === "string" && /^[a-f0-9]{64}$/.test(m.sha256);
}
