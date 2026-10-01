import { createHash, randomBytes } from "node:crypto";

export function hashReceiptPortalToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isReceiptPortalToken(token: string) {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function generateReceiptPortalToken() {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashReceiptPortalToken(token),
    tokenHint: token.slice(-6),
  };
}

export function receiptPortalUrl(token: string, origin = process.env.NEXT_PUBLIC_APP_URL ?? "") {
  return `${origin.replace(/\/$/, "")}/recepcion/${encodeURIComponent(token)}`;
}

export function isReceiptPortalDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isReceiptPortalEvidenceSignature(bytes: Uint8Array, mimeType: string) {
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
  if (mimeType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png") return ascii(0, 8) === "\x89PNG\r\n\x1a\n";
  if (mimeType === "image/webp") return bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP";
  if (mimeType === "application/pdf") return ascii(0, 5) === "%PDF-";
  if (mimeType === "image/heic") {
    return bytes.length >= 12 && ascii(4, 4) === "ftyp" &&
      ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(ascii(8, 4));
  }
  return false;
}

export type ReceiptPortalLineInput = {
  order_item_id: string;
  quantity: number;
  notes: string | null;
};

export function validateReceiptPortalLines(
  input: unknown,
  pendingByItemId: ReadonlyMap<string, number>
): ReceiptPortalLineInput[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > 100) return null;
  const seen = new Set<string>();
  const lines: ReceiptPortalLineInput[] = [];
  for (const value of input) {
    if (!value || typeof value !== "object") return null;
    const line = value as Record<string, unknown>;
    const quantity = line.quantity;
    if (
      typeof line.order_item_id !== "string" ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(line.order_item_id) ||
      seen.has(line.order_item_id) ||
      typeof quantity !== "number" ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      Math.round(quantity * 100) / 100 !== quantity ||
      !pendingByItemId.has(line.order_item_id) ||
      quantity > (pendingByItemId.get(line.order_item_id) ?? 0) ||
      (line.notes != null && (typeof line.notes !== "string" || line.notes.length > 500))
    ) {
      return null;
    }
    seen.add(line.order_item_id);
    lines.push({
      order_item_id: line.order_item_id,
      quantity,
      notes: typeof line.notes === "string" ? line.notes.trim() || null : null,
    });
  }
  return lines;
}
