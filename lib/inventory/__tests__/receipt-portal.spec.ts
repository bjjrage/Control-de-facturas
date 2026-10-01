import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  generateReceiptPortalToken,
  hashReceiptPortalToken,
  isReceiptPortalDate,
  isReceiptPortalEvidenceSignature,
  isReceiptPortalToken,
  receiptPortalUrl,
  validateReceiptPortalLines,
} from "../receipt-portal";

const repoRoot = process.cwd();
const migrationPath = fs.readdirSync(path.join(repoRoot, "supabase", "migrations"))
  .find((name) => name.endsWith("_restore_receipt_portal_canonical.sql"));
const migration = migrationPath
  ? fs.readFileSync(path.join(repoRoot, "supabase", "migrations", migrationPath), "utf8")
  : "";
const receiptActionSource = fs.readFileSync(
  path.join(repoRoot, "app", "(internal)", "orders", "oc-recepcion-actions.ts"),
  "utf8"
);
const portalRouteSource = fs.readFileSync(
  path.join(repoRoot, "app", "api", "recepcion-portal", "[token]", "route.ts"),
  "utf8"
);
const receivingUiSource = fs.readFileSync(
  path.join(repoRoot, "app", "(internal)", "orders", "[id]", "recepcion-section.tsx"),
  "utf8"
);
const proxySource = fs.readFileSync(path.join(repoRoot, "proxy.ts"), "utf8");

describe("canonical receipt portal contracts", () => {
  it("uses an unguessable URL token and persists only its digest", () => {
    const token = generateReceiptPortalToken();
    expect(token.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isReceiptPortalToken(token.token)).toBe(true);
    expect(isReceiptPortalToken("not-a-token")).toBe(false);
    expect(token.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(token.tokenHash).toBe(hashReceiptPortalToken(token.token));
    expect(token.tokenHash).not.toContain(token.token);
    expect(token.tokenHint).toBe(token.token.slice(-6));
  });

  it("builds the token portal URL and rejects normalized invalid dates", () => {
    expect(receiptPortalUrl("abc_def", "https://erp.example/")).toBe("https://erp.example/recepcion/abc_def");
    expect(isReceiptPortalDate("2026-09-25")).toBe(true);
    expect(isReceiptPortalDate("2026-02-30")).toBe(false);
    expect(isReceiptPortalDate("25-09-2026")).toBe(false);
  });

  it("checks uploaded evidence signatures instead of trusting browser MIME labels", () => {
    expect(isReceiptPortalEvidenceSignature(new Uint8Array([0xff, 0xd8, 0xff, 0x00]), "image/jpeg")).toBe(true);
    expect(isReceiptPortalEvidenceSignature(new TextEncoder().encode("%PDF-1.7"), "application/pdf")).toBe(true);
    expect(isReceiptPortalEvidenceSignature(new TextEncoder().encode("<html>"), "application/pdf")).toBe(false);
  });

  it("accepts only unique positive two-decimal quantities within pending amounts", () => {
    const itemId = "11111111-1111-4111-8111-111111111111";
    const pending = new Map([[itemId, 4]]);
    expect(validateReceiptPortalLines([{ order_item_id: itemId, quantity: 2.5 }], pending)).toEqual([
      { order_item_id: itemId, quantity: 2.5, notes: null },
    ]);
    expect(validateReceiptPortalLines([
      { order_item_id: itemId, quantity: 2 },
      { order_item_id: itemId, quantity: 1 },
    ], pending)).toBeNull();
    expect(validateReceiptPortalLines([{ order_item_id: itemId, quantity: 4.01 }], pending)).toBeNull();
    expect(validateReceiptPortalLines([{ order_item_id: itemId, quantity: 1.001 }], pending)).toBeNull();
    expect(validateReceiptPortalLines([{ order_item_id: itemId, quantity: Number.NaN }], pending)).toBeNull();
    expect(validateReceiptPortalLines([{ order_item_id: itemId, quantity: 1, notes: "x".repeat(501) }], pending)).toBeNull();
  });

  it("creates token links only through the service-role RPC and pins search_path", () => {
    expect(migration).toContain("ALTER TABLE public.receipt_portal_links ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("REVOKE ALL ON TABLE public.receipt_portal_links FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("GRANT SELECT, INSERT, UPDATE ON TABLE public.receipt_portal_links TO service_role");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.create_receipt_portal_link");
    expect(migration).toContain("SET search_path = ''");
  });

  it("routes portal submissions through canonical receipt creation, never legacy receipt inserts", () => {
    const submit = migration.split("CREATE OR REPLACE FUNCTION public.submit_receipt_portal")[1]?.split("$$;")[0] ?? "";
    expect(submit).toContain("public.inventory_create_receipt(");
    expect(submit).toContain("oi.producto_id AS order_product_id");
    expect(submit).toContain("IF v_item.order_product_id IS NOT NULL THEN");
    expect(submit).not.toMatch(/INSERT\s+INTO\s+public\.oc_recepciones/i);
    expect(submit).not.toMatch(/INSERT\s+INTO\s+public\.oc_recepcion_items/i);
    expect(submit).toContain("SET active = false, last_used_at = now()");
    expect(migration).toContain("inventory_set_receipt_item_product");
    expect(migration).toContain("v_order_product_id IS DISTINCT FROM p_product_id");
    expect(receiptActionSource).toContain("confirmInventoryReceipt(supabase");
  });

  it("does not expose token submission RPCs to browser roles", () => {
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("TO service_role");
    expect(migration).toContain("p_updated_by IS DISTINCT FROM auth.uid()");
    expect(migration).toContain("public.current_empresa_id() IS DISTINCT FROM p_empresa_id");
  });

  it("wires public token access to a human-reviewed canonical receipt flow", () => {
    expect(proxySource).toContain('path.startsWith("/recepcion/")');
    expect(proxySource).toContain('path.startsWith("/api/recepcion-portal/")');
    expect(proxySource).toContain('response.headers.set("Referrer-Policy", "no-referrer")');
    expect(portalRouteSource).toContain('.rpc("submit_receipt_portal"');
    expect(portalRouteSource).toContain('storage.from("warehouse-evidence").upload');
    expect(receivingUiSource).toContain("Evidencia recibida");
    expect(receivingUiSource).toContain("Sin vínculo no se genera movimiento de inventario.");
    expect(receivingUiSource).toContain("updateReceiptProductMapping");
    expect(receiptActionSource).toContain('rpc("inventory_set_receipt_item_product"');
    expect(receiptActionSource).toContain("confirmInventoryReceipt(supabase");
  });
});
