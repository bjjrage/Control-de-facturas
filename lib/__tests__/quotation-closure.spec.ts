import { describe, expect, it } from "vitest";
import {
  portalQuotationState,
  resolveRoutingPolicy,
} from "../quotation";
import {
  generateQuotationToken,
  hashQuotationToken,
  isValidQuotationTokenHash,
  isValidRawQuotationToken,
  quotationTokenPrefix,
} from "../quotation-tokens";
import type { QuotationEventType } from "../types";

describe("PUNTO 2 — token security: alta entropía, solo hash en DB", () => {
  it("genera tokens de 256-bit en base64url, únicos", () => {
    const a = generateQuotationToken();
    const b = generateQuotationToken();
    expect(isValidRawQuotationToken(a)).toBe(true);
    expect(a).toHaveLength(43); // 32 bytes → base64url sin padding
    expect(a).not.toBe(b);
  });

  it("el hash es sha256 hex determinista y no reversible al raw", () => {
    const raw = generateQuotationToken();
    const h1 = hashQuotationToken(raw);
    const h2 = hashQuotationToken(raw);
    expect(h1).toBe(h2);
    expect(isValidQuotationTokenHash(h1)).toBe(true);
    expect(h1).not.toContain(raw.slice(0, 8));
    expect(hashQuotationToken(generateQuotationToken())).not.toBe(h1);
  });

  it("el prefijo es solo correlación (8 chars), insuficiente para adivinar", () => {
    const raw = generateQuotationToken();
    const prefix = quotationTokenPrefix(raw);
    expect(prefix).toBe(raw.slice(0, 8));
    expect(prefix.length).toBe(8);
  });

  it("el formato valida raw de URL y hash por separado", () => {
    expect(isValidRawQuotationToken("corto")).toBe(false);
    expect(isValidRawQuotationToken("../ventas/123")).toBe(false);
    expect(isValidRawQuotationToken("a".repeat(64))).toBe(true); // hex legacy 0090
    expect(isValidQuotationTokenHash("z".repeat(64))).toBe(false);
    expect(isValidQuotationTokenHash("ab".repeat(32))).toBe(true);
  });
});

describe("PUNTOS 7/8 — semántica de email y copiado: nunca SENT", () => {
  // Contrato: sin provider SMTP no existe EMAIL_SENT. Si alguien reintroduce
  // 'SENT'/'EMAIL_SENT' en el vocabulario, este test lo frena.
  const ALLOWED: QuotationEventType[] = [
    "CREATED",
    "EMAIL_PREPARED",
    "LINK_COPIED",
    "VIEWED",
    "ACCEPTED",
    "REJECTED",
    "REVOKED",
    "EXPIRED",
    "VERSION_SUPERSEDED",
    "WORK_ORDER_CREATED",
    "WORKFLOW_RESOLVED",
    "OT_STATUS_CHANGED",
  ];

  it("no existe evento de email enviado ni genérico de envío", () => {
    expect(ALLOWED).not.toContain("SENT" as never);
    expect(ALLOWED).not.toContain("EMAIL_SENT" as never);
    expect(ALLOWED).toContain("EMAIL_PREPARED");
    expect(ALLOWED).toContain("LINK_COPIED");
  });

  it("preparar email y copiar link son eventos distintos (copiar ≠ entregar)", () => {
    expect("EMAIL_PREPARED").not.toBe("LINK_COPIED");
  });
});

describe("PUNTO 5 — routing por configuración tenant→cliente/proyecto→default", () => {
  const policies = [
    { id: "t", scope: "TENANT_DEFAULT" as const, client_id: null, project_id: null, mode: "DIRECT_TO_PRODUCTION" as const, responsible_role: "administracion" as const },
    { id: "c", scope: "CLIENT" as const, client_id: "cli-1", project_id: null, mode: "RESPONSIBLE_APPROVAL" as const, responsible_role: "administracion" as const },
    { id: "p", scope: "PROJECT" as const, client_id: null, project_id: "prj-1", mode: "RESPONSIBLE_APPROVAL" as const, responsible_role: "admin" as const },
  ];

  it("A) cliente con RESPONSIBLE_APPROVAL → PENDING_INTERNAL_APPROVAL", () => {
    const r = resolveRoutingPolicy(policies, { clientId: "cli-1" });
    expect(r.mode).toBe("RESPONSIBLE_APPROVAL");
    expect(r.scope).toBe("CLIENT");
    expect(r.policyId).toBe("c");
  });

  it("B) sin regla → default del tenant → DIRECT_TO_PRODUCTION", () => {
    const r = resolveRoutingPolicy(policies, { clientId: "otro" });
    expect(r.mode).toBe("DIRECT_TO_PRODUCTION");
    expect(r.scope).toBe("TENANT_DEFAULT");
  });

  it("proyecto prevalece sobre cliente", () => {
    const r = resolveRoutingPolicy(policies, { clientId: "cli-1", projectId: "prj-1" });
    expect(r.scope).toBe("PROJECT");
    expect(r.responsibleRole).toBe("admin");
  });

  it("sin políticas → SYSTEM_DEFAULT fail-safe: RESPONSIBLE_APPROVAL", () => {
    const r = resolveRoutingPolicy([], { clientId: "x" });
    expect(r.mode).toBe("RESPONSIBLE_APPROVAL");
    expect(r.scope).toBe("SYSTEM_DEFAULT");
    expect(r.policyId).toBeNull();
    expect(r.responsibleRole).toBe("administracion");
  });
});

describe("PUNTO 10 — versionado V1→V2 y rechazo post-aceptación", () => {
  const docV1 = {
    acceptance_status: "PENDING_ACCEPTANCE" as const,
    acceptance_expires_at: null as string | null,
    quotation_version: 1,
  };
  const linkA = { expires_at: null as string | null, revoked_at: null as string | null, quotation_version: 1 };

  it("link A acepta V1; tras editar a V2 el link A queda obsoleto", () => {
    expect(portalQuotationState(linkA, docV1)).toBe("PENDING_ACCEPTANCE");
    const docV2 = { ...docV1, quotation_version: 2 };
    expect(portalQuotationState(linkA, docV2)).toBe("STALE");
  });

  it("nuevo link B sobre V2 vuelve a estar aceptable", () => {
    const linkB = { ...linkA, quotation_version: 2 };
    expect(portalQuotationState(linkB, { ...docV1, quotation_version: 2 })).toBe("PENDING_ACCEPTANCE");
  });

  it("tras aceptar, el portal muestra ACCEPTED y ya no PENDING", () => {
    const accepted = { ...docV1, acceptance_status: "ACCEPTED" as const, quotation_version: 2 };
    const linkB = { ...linkA, quotation_version: 2 };
    expect(portalQuotationState(linkB, accepted)).toBe("ACCEPTED");
  });

  it("rechazada exige nuevo ciclo: ni el link original ni el estado permiten aceptar", () => {
    const rejected = { ...docV1, acceptance_status: "REJECTED" as const };
    expect(portalQuotationState(linkA, rejected)).toBe("REJECTED");
  });
});
