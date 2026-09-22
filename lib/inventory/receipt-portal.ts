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
    if (
      typeof line.order_item_id !== "string" ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(line.order_item_id) ||
      seen.has(line.order_item_id) ||
      typeof line.quantity !== "number" ||
      !Number.isFinite(line.quantity) ||
      line.quantity <= 0 ||
      !pendingByItemId.has(line.order_item_id) ||
      line.quantity > (pendingByItemId.get(line.order_item_id) ?? 0)
    ) {
      return null;
    }
    if (line.notes != null && typeof line.notes !== "string") return null;
    seen.add(line.order_item_id);
    lines.push({
      order_item_id: line.order_item_id,
      quantity: line.quantity,
      notes: typeof line.notes === "string" ? line.notes.trim().slice(0, 500) || null : null,
    });
  }
  return lines;
}
