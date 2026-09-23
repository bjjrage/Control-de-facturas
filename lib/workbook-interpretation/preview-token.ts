import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const PREVIEW_TOKEN_TTL_MS = 15 * 60 * 1000;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function signingSecret(): string {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Workbook preview signing is unavailable.");
  return secret;
}

function digest(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function signature(expiresAt: number, fileDigest: string, resultDigest: string, userId: string, empresaId: string, secret: string): Buffer {
  const payload = ["workbook-preview-v1", expiresAt, fileDigest, resultDigest, userId, empresaId].join("\n");
  return createHmac("sha256", secret).update(payload).digest();
}

export function createWorkbookPreviewToken(args: {
  fileBytes: Uint8Array;
  result: unknown;
  userId: string;
  empresaId: string;
  now?: number;
  secret?: string;
}): string {
  const expiresAt = (args.now ?? Date.now()) + PREVIEW_TOKEN_TTL_MS;
  const resultDigest = digest(stableJson(args.result));
  const fileDigest = digest(args.fileBytes);
  const sig = signature(expiresAt, fileDigest, resultDigest, args.userId, args.empresaId, args.secret ?? signingSecret()).toString("base64url");
  return `${expiresAt}.${sig}`;
}

export function verifyWorkbookPreviewToken(args: {
  token: string;
  fileBytes: Uint8Array;
  result: unknown;
  userId: string;
  empresaId: string;
  now?: number;
  secret?: string;
}): boolean {
  const [expiryText, suppliedSignature, ...extra] = args.token.split(".");
  const expiresAt = Number(expiryText);
  const now = args.now ?? Date.now();
  if (extra.length || !/^\d{13}$/.test(expiryText ?? "") || !Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + PREVIEW_TOKEN_TTL_MS + 1000 || !suppliedSignature) return false;

  try {
    const expected = signature(
      expiresAt,
      digest(args.fileBytes),
      digest(stableJson(args.result)),
      args.userId,
      args.empresaId,
      args.secret ?? signingSecret(),
    );
    const supplied = Buffer.from(suppliedSignature, "base64url");
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  } catch {
    return false;
  }
}
