import { describe, expect, it } from "vitest";
import {
  canEditQuotation,
  canSendForAcceptance,
  isQuotationExpired,
  isTokenStale,
  isValidPortalTokenFormat,
  portalQuotationState,
  quotationPortalPath,
  tokenExpiresAt,
} from "../quotation";

const doc = (over: Record<string, unknown> = {}) => ({
  doc_type: "PROFORMA" as const,
  status: "BORRADOR" as const,
  acceptance_status: "PENDING_ACCEPTANCE" as const,
  acceptance_expires_at: null as string | null,
  quotation_version: 3,
  total: 150000,
  ...over,
});

const tok = (over: Record<string, unknown> = {}) => ({
  expires_at: null as string | null,
  revoked_at: null as string | null,
  quotation_version: 3,
  ...over,
});

describe("quotation portal helpers (migración 0090)", () => {
  it("el link congela la versión: token viejo queda obsoleto tras editar", () => {
    expect(isTokenStale(tok({ quotation_version: 2 }), doc())).toBe(true);
    expect(isTokenStale(tok(), doc())).toBe(false);
  });

  it("la expiración usa la más restrictiva entre link y documento", () => {
    const early = new Date("2026-01-01T00:00:00Z").toISOString();
    const late = new Date("2026-06-01T00:00:00Z").toISOString();
    expect(tokenExpiresAt(tok({ expires_at: late }), doc({ acceptance_expires_at: early }))).toBe(early);
    expect(tokenExpiresAt(tok({ expires_at: early }), doc({ acceptance_expires_at: late }))).toBe(early);
    expect(tokenExpiresAt(tok(), doc())).toBeNull();
  });

  it("vencimiento se deriva por reloj, sin cron", () => {
    const past = new Date("2020-01-01T00:00:00Z").toISOString();
    const future = new Date("2030-01-01T00:00:00Z").toISOString();
    expect(isQuotationExpired(tok({ expires_at: past }), doc())).toBe(true);
    expect(isQuotationExpired(tok({ expires_at: future }), doc())).toBe(false);
    expect(isQuotationExpired(tok(), doc({ acceptance_status: "ACCEPTED" }))).toBe(false);
    expect(isQuotationExpired(tok(), doc({ acceptance_status: "DRAFT" }))).toBe(false);
  });

  it("el estado del portal prioriza revocado > obsoleto > vencido > aceptación", () => {
    expect(portalQuotationState(tok({ revoked_at: new Date().toISOString() }), doc())).toBe("REVOKED");
    expect(portalQuotationState(tok({ quotation_version: 1 }), doc())).toBe("STALE");
    expect(
      portalQuotationState(tok({ expires_at: new Date("2020-01-01T00:00:00Z").toISOString() }), doc())
    ).toBe("EXPIRED");
    expect(portalQuotationState(tok(), doc())).toBe("PENDING_ACCEPTANCE");
    expect(portalQuotationState(tok(), doc({ acceptance_status: "ACCEPTED" }))).toBe("ACCEPTED");
  });

  it("solo PROFORMA en borrador con total > 0 se puede enviar a aceptación", () => {
    expect(canSendForAcceptance(doc() as never)).toBe(true);
    expect(canSendForAcceptance(doc({ doc_type: "FACTURA" }) as never)).toBe(false);
    expect(canSendForAcceptance(doc({ status: "EMITIDA" }) as never)).toBe(false);
    expect(canSendForAcceptance(doc({ total: 0 }) as never)).toBe(false);
    expect(canSendForAcceptance(doc({ acceptance_status: "ACCEPTED" }) as never)).toBe(false);
  });

  it("la cotización aceptada es inmutable; pendiente/borrador sí editable", () => {
    expect(canEditQuotation({ doc_type: "PROFORMA", acceptance_status: "ACCEPTED" })).toBe(false);
    expect(canEditQuotation({ doc_type: "PROFORMA", acceptance_status: "PENDING_ACCEPTANCE" })).toBe(true);
    expect(canEditQuotation({ doc_type: "PROFORMA", acceptance_status: "DRAFT" })).toBe(true);
  });

  it("el token del portal tiene formato hex seguro y ruta propia (la OT no tiene portal)", () => {
    expect(isValidPortalTokenFormat("".padEnd(64, "a"))).toBe(true);
    expect(isValidPortalTokenFormat("corto")).toBe(false);
    expect(isValidPortalTokenFormat("../ventas/123")).toBe(false);
    expect(quotationPortalPath("abc")).toBe("/cotizacion/abc");
  });
});
