import { createHash } from "node:crypto";

export class EmailApprovalMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailApprovalMismatchError";
  }
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function isSha256Digest(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

export function assertAttachmentDigest(bytes: Uint8Array, expected: string | null): void {
  if (!isSha256Digest(expected) || sha256Bytes(bytes) !== expected) {
    throw new EmailApprovalMismatchError("El contenido del adjunto cambió después de preparar el correo; se necesita una nueva aprobación");
  }
}
