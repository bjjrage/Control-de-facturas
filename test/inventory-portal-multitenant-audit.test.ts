import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Auditoría READ-ONLY de la cadena de consumo del portal del pañol.
 * El portal usa service_role (createAdminClient): la seguridad no depende de RLS
 * sino de validaciones explícitas de la app y de las funciones SQL canónicas.
 * Este test fija cada eslabón contra la baseline SQL y la ruta de API.
 */
const route = readFileSync(resolve(process.cwd(), "app/api/warehouse-portal/[token]/route.ts"), "utf8").replace(/\r\n/g, "\n");
const portalData = readFileSync(resolve(process.cwd(), "lib/inventory/warehouse-portal-data.ts"), "utf8").replace(/\r\n/g, "\n");
const baseline = readFileSync(resolve(process.cwd(), "supabase/migrations/20261002231537_production_schema_baseline.sql"), "utf8").replace(/\r\n/g, "\n");
const guard = readFileSync(resolve(process.cwd(), "supabase/migrations/20261003134723_inventory_confirmed_opening_guard.sql"), "utf8").replace(/\r\n/g, "\n");

const postMovement = baseline.slice(
  baseline.indexOf('CREATE FUNCTION "public"."inventory_post_movement"'),
  baseline.indexOf("inventory_post_movement(\"uuid\", \"uuid\", numeric", baseline.indexOf('CREATE FUNCTION "public"."inventory_post_movement"') + 1000),
);

describe("eslabones de la app (service_role)", () => {
  it("el token se resuelve por hash y solo enlaces activos y no vencidos", () => {
    expect(route).toContain('from("warehouse_portal_links")');
    expect(route).toContain('.eq("token_hash", hashWarehousePortalToken(token))');
    expect(route).toContain("!link || !link.active || (link.expires_at && new Date(link.expires_at).getTime() <= Date.now())");
  });

  it("la ubicación del enlace debe pertenecer a la empresa del enlace", () => {
    const linkBlock = route.slice(route.indexOf("async function resolveLink"), route.indexOf("export async function GET"));
    expect(linkBlock).toContain('.eq("id", link.location_id)');
    expect(linkBlock).toContain('.eq("empresa_id", link.empresa_id)');
  });

  it("la partida se valida contra la obra de la ubicación resuelta (no contra parámetros del cliente)", () => {
    const consumption = route.slice(route.indexOf('action === "consumption"'), route.indexOf("inventory_portal_consumption"));
    expect(consumption).toContain('.eq("project_id", location.project_id)');
    expect(consumption).not.toMatch(/formData\.get\("project_id"\)/);
    expect(consumption).not.toMatch(/formData\.get\("empresa_id"\)/);
  });

  it("el producto debe ser activo y de la empresa del enlace", () => {
    const consumption = route.slice(route.indexOf('action === "consumption"'), route.indexOf("inventory_portal_consumption"));
    expect(consumption).toContain('.eq("empresa_id", link.empresa_id)');
    expect(consumption).toContain('select("id, nombre, unidad, activo")');
    expect(consumption).toContain("!product || !product.activo");
  });

  it("la empresa y el proyecto se derivan del enlace/ubicación en la RPC, nunca del cliente", () => {
    const rpc = route.slice(route.indexOf("inventory_portal_consumption"), route.indexOf("// Upload photo evidence"));
    expect(rpc).toContain("p_product: product.id");
    expect(rpc).toContain("p_budget: budgetItemId");
    expect(rpc).toContain("p_quantity: quantity");
    expect(rpc).not.toMatch(/p_empresa_id:\s*formData/i);
  });

  it("el intento estable (idempotencia) exige UUID y partida obligatoria", () => {
    const consumption = route.slice(route.indexOf('action === "consumption"'), route.indexOf("inventory_portal_consumption"));
    expect(consumption).toContain("!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(attempt) || !budgetItemId");
  });

  it("la cantidad se valida positiva y finita en la ruta", () => {
    const consumption = route.slice(route.indexOf('action === "consumption"'), route.indexOf("inventory_portal_consumption"));
    expect(consumption).toContain("!Number.isFinite(quantity) || quantity <= 0");
  });

  it("el contexto del portal solo expone datos de la obra resuelta y la RPC sigue derivando empresa del enlace", () => {
    expect(portalData).toContain(".eq(\"id\", location.project_id)\n    .eq(\"empresa_id\", link.empresa_id)");
    expect(portalData).toContain("empresaId: link.empresa_id");
  });
});

describe("eslabones SQL canónicos (inventory_portal_consumption / inventory_post_movement)", () => {
  const portalFn = guard.slice(guard.indexOf("CREATE FUNCTION public.inventory_portal_consumption"), guard.indexOf("REVOKE ALL ON FUNCTION public.inventory_portal_consumption"));

  it("la RPC del portal solo corre con service_role y bloquea anon/authenticated", () => {
    expect(portalFn).toContain("auth.jwt()->>'role','')<>'service_role' THEN RAISE EXCEPTION 'Server only'");
    expect(guard).toContain("REVOKE ALL ON FUNCTION public.inventory_portal_consumption(text,uuid,uuid,numeric,uuid,jsonb) FROM PUBLIC,anon,authenticated");
    expect(guard).toContain("GRANT EXECUTE ON FUNCTION public.inventory_portal_consumption(text,uuid,uuid,numeric,uuid,jsonb) TO service_role");
  });

  it("token inválido/revocado/vencido se rechaza dentro de la función SQL", () => {
    expect(portalFn).toContain("SELECT * INTO link FROM public.warehouse_portal_links WHERE token_hash=p_token_hash FOR UPDATE");
    expect(portalFn).toContain("IF NOT FOUND OR NOT link.active OR (link.expires_at IS NOT NULL AND link.expires_at<=now()) THEN RAISE EXCEPTION 'Portal expired/revoked'");
  });

  it("obra/partida/intento obligatorios y ubicación del enlace dentro de la empresa", () => {
    expect(portalFn).toContain("SELECT * INTO location FROM public.inventory_locations WHERE id=link.location_id AND empresa_id=link.empresa_id AND active AND location_type='PROJECT'");
    expect(portalFn).toContain("IF NOT FOUND OR location.project_id IS NULL OR p_budget IS NULL OR p_attempt IS NULL THEN RAISE EXCEPTION 'Project, budget and stable attempt required'");
    expect(portalFn).toContain("p_empresa_id=>link.empresa_id");
    expect(portalFn).toContain("p_movement_type=>'CONSUMPTION'");
    expect(portalFn).toContain("p_idempotency_key=>'warehouse-portal-consumption:'||link.id::text||':'||p_attempt::text");
  });

  it("movement no service_role queda atado al tenant y al rol interno", () => {
    expect(postMovement).toContain("IF auth.role() <> 'service_role' THEN");
    expect(postMovement).toContain("public.current_empresa_id() IS DISTINCT FROM p_empresa_id");
    expect(postMovement).toContain("public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])");
  });

  it("cantidad inválida: null, cero o negativa se rechaza en SQL", () => {
    expect(postMovement).toContain("IF p_quantity IS NULL OR p_quantity = 0 OR (v_type <> 'ADJUSTMENT' AND p_quantity < 0) THEN");
    expect(postMovement).toContain("RAISE EXCEPTION 'La cantidad del movimiento no es válida'");
  });

  it("sin partida el consumo se rechaza, y debe salir del pañol de la obra contextual", () => {
    expect(postMovement).toContain("IF v_type = 'CONSUMPTION' THEN\n    IF v_context_project IS NULL OR p_budget_item_id IS NULL THEN\n      RAISE EXCEPTION 'El consumo requiere proyecto y partida presupuestaria';");
    expect(postMovement).toContain("IF v_from_project IS DISTINCT FROM v_context_project THEN\n      RAISE EXCEPTION 'El consumo debe salir del pañol de la obra indicada';");
  });

  it("partida de otra obra o de otra empresa se rechaza con JOIN a projects.empresa_id", () => {
    expect(postMovement).toContain(
      "FROM public.budget_items bi\n      JOIN public.projects pr ON pr.id = bi.project_id\n      WHERE bi.id = p_budget_item_id\n        AND bi.project_id = v_context_project\n        AND pr.empresa_id = p_empresa_id",
    );
    expect(postMovement).toContain("RAISE EXCEPTION 'La partida no pertenece al proyecto y tenant indicados'");
  });

  it("producto de otra empresa se rechaza en SQL", () => {
    expect(postMovement).toContain("IF v_product_empresa IS NULL OR v_product_empresa IS DISTINCT FROM p_empresa_id THEN");
    expect(postMovement).toContain("RAISE EXCEPTION 'El material no pertenece a la empresa'");
  });

  it("ubicación ajena al enlace/empresa o inactiva se rechaza en SQL", () => {
    expect(postMovement).toContain("IF v_location_empresa IS NULL OR v_location_empresa IS DISTINCT FROM p_empresa_id THEN");
    expect(postMovement).toContain("RAISE EXCEPTION 'La ubicación origen no pertenece a la empresa o está inactiva'");
  });

  it("idempotencia: mismo intento devuelve el mismo movimiento; datos distintos se rechazan; lock de empresa+clave", () => {
    expect(postMovement).toContain("IF v_idempotency_key IS NULL THEN\n    RAISE EXCEPTION 'La idempotency_key es obligatoria';");
    expect(postMovement).toContain(
      "PERFORM pg_catalog.pg_advisory_xact_lock(\n    pg_catalog.hashtextextended(p_empresa_id::text || ':' || v_idempotency_key, 0)\n  );",
    );
    expect(postMovement).toContain("WHERE empresa_id = p_empresa_id AND idempotency_key = v_idempotency_key");
    expect(postMovement).toContain("RAISE EXCEPTION 'La idempotency_key ya fue usada para otra operación'");
    expect(postMovement).toContain("RETURN v_existing.id;");
    expect(postMovement).toContain("AND source_id = p_source_id\n      AND source_line_id IS NOT DISTINCT FROM p_source_line_id");
    expect(postMovement).toContain("RAISE EXCEPTION 'El origen ya fue aplicado con otra operación'");
  });

  it("stock insuficiente en la ubicación origen se rechaza (sin saldo negativo)", () => {
    expect(postMovement).toContain("RAISE EXCEPTION 'Stock insuficiente en la ubicación origen: faltan %', v_remaining;");
  });
});
