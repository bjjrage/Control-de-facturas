import { RfqStatus } from "./types";

// Statuses in which an RFQ can still be actively bidding. Everything else
// (AUTORIZADO, CANCELADO, plus any of the legacy invoice-lifecycle values
// that were never actually wired up) is a closed state.
const BIDDING_STATUSES: RfqStatus[] = ["BORRADOR", "COTIZANDO", "OFERTAS_RECIBIDAS"];

export type RfqLike = { status: RfqStatus; expires_at: string };

/**
 * Whether new quotes can still come in. Purely derived from (status,
 * expires_at) — nothing flips a DB flag when the clock runs out, so no cron
 * job is needed. Reopening just pushes expires_at forward again.
 */
export function isRfqOpen(rfq: RfqLike): boolean {
  if (!BIDDING_STATUSES.includes(rfq.status)) return false;
  return new Date(rfq.expires_at).getTime() > Date.now();
}

/** Human label for why a closed RFQ is closed. Null while still open. */
export function rfqClosedReason(rfq: RfqLike): "Autorizada" | "Cancelada" | "Vencida" | null {
  if (isRfqOpen(rfq)) return null;
  if (rfq.status === "AUTORIZADO") return "Autorizada";
  if (rfq.status === "CANCELADO") return "Cancelada";
  if (BIDDING_STATUSES.includes(rfq.status)) return "Vencida";
  return "Cancelada"; // any other legacy/unused status, treated as a dead end
}

/** Whether reopening makes sense: closed, but no order was ever authorized. */
export function canReopenRfq(rfq: RfqLike): boolean {
  return !isRfqOpen(rfq) && rfq.status !== "AUTORIZADO";
}

export const DEFAULT_RFQ_WINDOW_HOURS = 72;
