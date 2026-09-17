import {
  QuotationAcceptanceStatus,
  SalesDocument,
  SalesQuotationToken,
  WorkOrderStatus,
} from "./types";

/** Solo PROFORMA es cotización aceptable por el cliente. */
export function isQuotationDoc(doc: Pick<SalesDocument, "doc_type">) {
  return doc.doc_type === "PROFORMA";
}

export const QUOTATION_ACCEPTANCE_LABELS: Record<QuotationAcceptanceStatus, string> = {
  DRAFT: "Borrador",
  PENDING_ACCEPTANCE: "Pendiente de aceptación",
  ACCEPTED: "Aceptada",
  REJECTED: "Rechazada",
  EXPIRED: "Vencida",
};

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  PENDIENTE: "Pendiente",
  EN_CURSO: "En curso",
  COMPLETADA: "Completada",
  CANCELADA: "Cancelada",
};

/** Ruta pública del portal del cliente. La OT nunca tiene portal. */
export function quotationPortalPath(token: string) {
  return `/cotizacion/${token}`;
}

export function quotationPortalUrl(token: string, appUrl?: string | null) {
  const base = (appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  return base ? `${base}${quotationPortalPath(token)}` : quotationPortalPath(token);
}

/** Link utilizable: no revocado. La vigencia y la versión se evalúan aparte. */
export function isTokenRevoked(t: Pick<SalesQuotationToken, "revoked_at">) {
  return t.revoked_at !== null;
}

export function tokenExpiresAt(
  token: Pick<SalesQuotationToken, "expires_at">,
  doc: Pick<SalesDocument, "acceptance_expires_at">
): string | null {
  const candidates = [token.expires_at, doc.acceptance_expires_at].filter(
    (v): v is string => v !== null && v !== undefined
  );
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0];
}

export function isQuotationExpired(
  token: Pick<SalesQuotationToken, "expires_at" | "revoked_at"> | null,
  doc: Pick<SalesDocument, "acceptance_status" | "acceptance_expires_at">,
  now = Date.now()
): boolean {
  if (doc.acceptance_status === "EXPIRED") return true;
  if (doc.acceptance_status !== "PENDING_ACCEPTANCE") return false;
  const exp = token
    ? tokenExpiresAt(token, doc)
    : doc.acceptance_expires_at;
  if (!exp) return false;
  return new Date(exp).getTime() <= now;
}

/** El link corresponde a la versión vigente del documento. */
export function isTokenStale(
  token: Pick<SalesQuotationToken, "quotation_version">,
  doc: Pick<SalesDocument, "quotation_version">
) {
  return token.quotation_version !== doc.quotation_version;
}

/** Estado efectivo para mostrar en el portal (derivado, sin cron). */
export function portalQuotationState(
  token: Pick<SalesQuotationToken, "expires_at" | "revoked_at" | "quotation_version">,
  doc: Pick<SalesDocument, "acceptance_status" | "acceptance_expires_at" | "quotation_version">
): "REVOKED" | "STALE" | QuotationAcceptanceStatus {
  if (isTokenRevoked(token)) return "REVOKED";
  if (isTokenStale(token, doc)) return "STALE";
  if (doc.acceptance_status === "PENDING_ACCEPTANCE" && isQuotationExpired(token, doc)) {
    return "EXPIRED";
  }
  return doc.acceptance_status;
}

/** Solo DRAFT/PENDING se pueden editar sin romper una aceptación ya cerrada. */
export function canEditQuotation(doc: Pick<SalesDocument, "acceptance_status" | "doc_type">) {
  if (!isQuotationDoc(doc)) return true;
  return doc.acceptance_status === "DRAFT" || doc.acceptance_status === "PENDING_ACCEPTANCE";
}

/** Solo se puede enviar a aceptación una PROFORMA en BORRADOR/DRAFT con total > 0. */
export function canSendForAcceptance(doc: Pick<SalesDocument, "doc_type" | "status" | "acceptance_status" | "total">) {
  return (
    doc.doc_type === "PROFORMA" &&
    doc.status === "BORRADOR" &&
    (doc.acceptance_status === "DRAFT" || doc.acceptance_status === "PENDING_ACCEPTANCE") &&
    doc.total > 0
  );
}

export function isValidPortalTokenFormat(token: string) {
  // Raw de URL (base64url 256-bit nuevo, hex legacy de 0090): el portal lo
  // hashea (sha256) antes de cualquier lookup. Nunca viaja a la DB en claro.
  return /^[A-Za-z0-9_-]{32,128}$/.test(token);
}

/**
 * Resolución de política de routing en memoria (espejo de
 * resolve_work_order_policy para tests y UI): PROJECT → CLIENT →
 * TENANT_DEFAULT → SYSTEM_DEFAULT. Sin personas hardcodeadas.
 */
import type { WorkOrderApprovalMode, WorkOrderRoutingPolicy } from "./types";

export function resolveRoutingPolicy(
  policies: Pick<WorkOrderRoutingPolicy, "id" | "scope" | "client_id" | "project_id" | "mode" | "responsible_role">[],
  opts: { clientId: string; projectId?: string | null }
): { mode: WorkOrderApprovalMode; policyId: string | null; scope: string; responsibleRole: string } {
  if (opts.projectId) {
    const p = policies.find((x) => x.scope === "PROJECT" && x.project_id === opts.projectId);
    if (p) return { mode: p.mode, policyId: p.id, scope: p.scope, responsibleRole: p.responsible_role };
  }
  const c = policies.find((x) => x.scope === "CLIENT" && x.client_id === opts.clientId);
  if (c) return { mode: c.mode, policyId: c.id, scope: c.scope, responsibleRole: c.responsible_role };
  const t = policies.find((x) => x.scope === "TENANT_DEFAULT");
  if (t) return { mode: t.mode, policyId: t.id, scope: t.scope, responsibleRole: t.responsible_role };
  // Fail-safe (espejo de resolve_work_order_policy, 0092): sin configuración
  // no hay pase directo a producción.
  return { mode: "RESPONSIBLE_APPROVAL", policyId: null, scope: "SYSTEM_DEFAULT", responsibleRole: "administracion" };
}

export const WORKFLOW_STATUS_LABELS: Record<string, string> = {
  PENDING_INTERNAL_APPROVAL: "Pendiente de aprobación interna",
  READY_FOR_PRODUCTION: "Lista para producción",
};

export const APPROVAL_MODE_LABELS: Record<string, string> = {
  RESPONSIBLE_APPROVAL: "Aprobación por responsable",
  DIRECT_TO_PRODUCTION: "Directo a producción",
};
