"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createCanonicalRfq } from "@/lib/rfq/service";
import { explodeMaterialNeeds } from "@/lib/costing/insumos";
import { resolveContextMaterialPrices } from "@/lib/costing/project-prices";
import { aggregateElementsForBudgetItem } from "@/lib/bim/matching";
import type { BimElement, BudgetItem } from "@/lib/types";
import { ownerColumn, ownerValues, workspaceContextSchema, workspacePath, type WorkspaceContext } from "./context";
import { computeWorkspaceCosts, costSettingsSchema, DEFAULT_COST_SETTINGS, type WorkspaceFacts } from "./costs";

async function access(raw: WorkspaceContext, write = false) {
  const context = workspaceContextSchema.parse(raw);
  const profile = await requirePlan("pro", ["comercial", "administracion", "admin"]);
  if (!profile.active || !profile.empresa_active) throw new Error("Cuenta o empresa inactiva.");
  if (!["comercial", "administracion", "admin"].includes(profile.role)) throw new Error("Actor PREBID no autorizado.");
  const db = await createClient();
  const { data: owner, error } = await db.from(context.kind === "TENDER" ? "licitaciones" : "projects")
    .select("*").eq("id", context.id).eq("empresa_id", profile.empresa_id).maybeSingle();
  if (error || !owner) throw new Error("Contexto no encontrado o de otra empresa.");
  if (context.kind === "TENDER") {
    if (owner.moneda !== "PYG") throw new Error("El costeo PREBID requiere moneda PYG; no se infiere un cambio.");
    if (write) {
      const result = await db.from("licitacion_ofertas").select("estado").eq("licitacion_id", context.id).eq("empresa_id", profile.empresa_id).maybeSingle();
      if (result.error) throw new Error(result.error.message);
      if (result.data && result.data.estado !== "BORRADOR") throw new Error("Oferta presentada: historial inmutable.");
    }
  }
  return { context, profile, db, owner };
}
async function ensureOffer(db: Awaited<ReturnType<typeof createClient>>, context: WorkspaceContext, empresaId: string, actorId: string) {
  if (context.kind !== "TENDER") return;
  const { error } = await db.from("licitacion_ofertas").upsert({ licitacion_id: context.id, empresa_id: empresaId,
    created_by: actorId, estado: "BORRADOR", cost_settings: DEFAULT_COST_SETTINGS }, { onConflict: "licitacion_id", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}
async function result<T>(operation: () => Promise<T>) {
  try { return { data: await operation(), error: null }; }
  catch (error) { return { data: null, error: error instanceof Error ? error.message : "Error de workspace." }; }
}

export async function loadPrebidWorkspaceAction(tenderId: string, versionId?: string) {
  return result(async () => {
    const { db, context, profile, owner } = await access({ kind: "TENDER", id: tenderId });
    const [offerRes, versionsRes, productsRes, providersRes] = await Promise.all([
      db.from("licitacion_ofertas").select("*").eq("licitacion_id", tenderId).eq("empresa_id", profile.empresa_id).maybeSingle(),
      db.from("licitacion_oferta_versions").select("id,version,estado,snapshot_sha256,created_at").eq("tender_id", tenderId).eq("empresa_id", profile.empresa_id).order("version", { ascending: false }),
      db.from("productos").select("id,nombre,unidad").eq("empresa_id", profile.empresa_id).eq("activo", true).order("nombre"),
      db.from("providers").select("id,name").eq("empresa_id", profile.empresa_id).eq("active", true).order("name"),
    ]);
    for (const r of [offerRes, versionsRes, productsRes, providersRes]) if (r.error) throw new Error(r.error.message);
    const offer = offerRes.data;
    let facts: WorkspaceFacts, hash: string | null = null, selectedVersion: Record<string, any> | null = null;
    const selected = versionId ?? offer?.submitted_version_id;
    if (selected) {
      const r = await db.from("licitacion_oferta_versions").select("*").eq("id", z.uuid().parse(selected)).eq("tender_id", tenderId).eq("empresa_id", profile.empresa_id).single();
      if (r.error) throw new Error(r.error.message);
      selectedVersion = r.data;
      facts = r.data.snapshot.facts;
    } else {
      const r = await db.rpc("prebid_workspace", { p_tender_id: tenderId });
      if (r.error) throw new Error(r.error.message);
      facts = r.data.facts; hash = r.data.hash;
    }
    const costs = computeWorkspaceCosts(facts);
    let handoff: Record<string, any> | null = null;
    if (offer?.estado === "GANADA") {
      const r = await db.rpc("prebid_handoff_snapshot", { p_tender_id: tenderId });
      if (r.error) throw new Error(r.error.message);
      handoff = r.data;
    }
    const priceOptions = selected ? {} : Object.fromEntries(await resolveContextMaterialPrices({ supabase: db, admin: createAdminClient(),
      empresaId: profile.empresa_id, context, productIds: facts.products.map(p => p.id) }));
    return { owner, offer, versions: versionsRes.data ?? [], facts, hash, costs, priceOptions,
      selectedVersion, handoff, products: productsRes.data ?? [], providers: providersRes.data ?? [],
      readOnly: !!selected || (!!offer && offer.estado !== "BORRADOR"),
      readyForProjectHandoff: offer?.estado === "GANADA" && !!offer.winning_version_id && Number(offer.awarded_amount)>0 && !!offer.awarded_confirmed_by };
  });
}

const budgetSchema = z.object({ id: z.uuid().optional(), code: z.string().trim().min(1).max(100), description: z.string().trim().min(1).max(2000),
  unit: z.string().trim().min(1).max(30), quantity: z.number().finite().positive().max(1e12), expectedVersion: z.string().optional() });
export async function saveWorkspaceBudgetItemAction(raw: WorkspaceContext, input: z.infer<typeof budgetSchema>) {
  return result(async () => {
    const { context, profile, db } = await access(raw, true); const row = budgetSchema.parse(input);
    await ensureOffer(db, context, profile.empresa_id, profile.id);
    const payload = { ...ownerValues(context), code: row.code, description: row.description, unit: row.unit, quantity: row.quantity };
    const r = row.id ? await db.from("budget_items").update(payload).eq("id", row.id).eq(ownerColumn(context), context.id)
      .eq("updated_at", row.expectedVersion ?? "").select("id").single()
      : await db.from("budget_items").insert(payload).select("id").single();
    if (r.error) throw new Error(r.error.message);
    revalidatePath(workspacePath(context)); return r.data;
  });
}
export async function importTenderComputoAction(tenderId: string) {
  return result(async () => {
    const { context, db, profile } = await access({ kind: "TENDER", id: tenderId }, true);
    await ensureOffer(db, context, profile.empresa_id, profile.id);
    const r = await db.rpc("prebid_import_computo", { p_tender_id: tenderId });
    if (r.error) throw new Error(r.error.message);
    revalidatePath(workspacePath(context)); return r.data;
  });
}
const apuSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("MATERIAL"), budgetItemId: z.uuid(), productoId: z.uuid(), quantity: z.number().finite().positive(), wastePct: z.number().finite().min(0).max(100) }),
  z.object({ kind: z.literal("LABOR"), budgetItemId: z.uuid(), description: z.string().trim().min(1), quantity: z.number().finite().positive(), cost: z.number().finite().min(0) }),
  z.object({ kind: z.literal("EQUIPMENT"), budgetItemId: z.uuid(), description: z.string().trim().min(1), quantity: z.number().finite().positive(), cost: z.number().finite().min(0) }),
  z.object({ kind: z.literal("SUBCONTRACT"), budgetItemId: z.uuid(), description: z.string().trim().min(1), cost: z.number().finite().min(0) }),
]);
export async function saveWorkspaceApuLineAction(raw: WorkspaceContext, input: z.infer<typeof apuSchema>) {
  return result(async () => {
    const { context, db, profile } = await access(raw, true); const line = apuSchema.parse(input);
    const b = await db.from("budget_items").select("id").eq("id", line.budgetItemId).eq(ownerColumn(context), context.id).single();
    if (b.error) throw new Error("Partida de otro contexto.");
    const common = { ...ownerValues(context), empresa_id: profile.empresa_id, budget_item_id: line.budgetItemId };
    let table: string, payload: Record<string, unknown>;
    if (line.kind === "MATERIAL") {
      const product = await db.from("productos").select("id").eq("id", line.productoId).eq("empresa_id", profile.empresa_id).eq("activo", true).single();
      if (product.error) throw new Error("Insumo de otra empresa.");
      table = "budget_item_materials"; payload = { ...common, producto_id: line.productoId, cantidad_por_unidad_ejecutada: line.quantity, desperdicio_pct: line.wastePct };
    } else if (line.kind === "SUBCONTRACT") {
      table = "budget_item_subcontracts"; payload = { ...common, descripcion: line.description, precio_por_unidad: line.cost };
    } else {
      table = line.kind === "LABOR" ? "budget_item_labor" : "budget_item_equipment";
      payload = { ...common, [line.kind === "LABOR" ? "rol" : "tipo_equipo"]: line.description, horas_por_unidad_ejecutada: line.quantity, costo_hora: line.cost };
    }
    const r = line.kind === "MATERIAL" ? await db.from(table).upsert(payload, { onConflict: "budget_item_id,producto_id" }) : await db.from(table).insert(payload);
    if (r.error) throw new Error(r.error.message);
    revalidatePath(workspacePath(context)); return true;
  });
}
export async function deleteWorkspaceApuLineAction(raw: WorkspaceContext, kind: "MATERIAL"|"LABOR"|"EQUIPMENT"|"SUBCONTRACT", id: string) {
  return result(async () => {
    const { context, db, profile } = await access(raw, true);
    const table = { MATERIAL: "budget_item_materials", LABOR: "budget_item_labor", EQUIPMENT: "budget_item_equipment", SUBCONTRACT: "budget_item_subcontracts" }[kind];
    if (!table) throw new Error("Tipo APU inválido.");
    const r = await db.from(table).delete().eq("id", z.uuid().parse(id)).eq("empresa_id", profile.empresa_id).eq(ownerColumn(context), context.id).select("id").single();
    if (r.error) throw new Error(r.error.message); revalidatePath(workspacePath(context)); return true;
  });
}
export async function adoptWorkspacePriceAction(raw: WorkspaceContext, input: { productoId: string; fuente: "MANUAL"|"COTIZACION"; precio?: number; quoteVersionItemId?: string }) {
  return result(async () => {
    const { context, db, profile } = await access(raw, true);
    // Generic RPC verifies company/context/product/provider/current version and takes the factual DB price.
    const productoId = z.uuid().parse(input.productoId);
    const source = z.enum(["MANUAL","COTIZACION"]).parse(input.fuente);
    if (source === "MANUAL") z.number().finite().positive().max(1e15).parse(input.precio);
    else z.uuid().parse(input.quoteVersionItemId);
    const r = await db.rpc("workspace_adopt_price", { p_context: context, p_product_id: productoId,
      p_source: source, p_price: source === "MANUAL" ? input.precio : null,
      p_quote_item_id: source === "COTIZACION" ? input.quoteVersionItemId : null });
    if (r.error) throw new Error(r.error.message); revalidatePath(workspacePath(context)); return r.data;
  });
}
export async function createWorkspaceDiscoveryAction(raw: WorkspaceContext, productId: string, providerIds: string[]) {
  return result(async () => {
    const { context, db, profile } = await access(raw, true);
    const pid = z.uuid().parse(productId); const vendors = z.array(z.uuid()).min(1).max(100).parse(providerIds);
    const [items, materials, product] = await Promise.all([
      db.from("budget_items").select("id,quantity").eq(ownerColumn(context), context.id),
      db.from("budget_item_materials").select("*").eq(ownerColumn(context), context.id).eq("empresa_id", profile.empresa_id).eq("producto_id", pid),
      db.from("productos").select("id,nombre,unidad").eq("id", pid).eq("empresa_id", profile.empresa_id).eq("activo", true).single(),
    ]);
    for (const r of [items, materials, product]) if (r.error) throw new Error(r.error.message);
    if (!product.data) throw new Error("Insumo no encontrado.");
    const needs = explodeMaterialNeeds((items.data ?? []).map(b => ({ id: b.id, quantity: b.quantity == null ? null : Number(b.quantity) })),
      (materials.data ?? []).map(m => ({ budgetItemId: m.budget_item_id, productoId: m.producto_id, cantidadPorUnidad: Number(m.cantidad_por_unidad_ejecutada), desperdicioPct: Number(m.desperdicio_pct) })));
    const need = needs.find(n => n.productoId === pid);
    if (!need || need.cantidad<=0) throw new Error("El material no tiene necesidad medida en este contexto.");
    const rfq = await createCanonicalRfq(db, { ...ownerValues(context), purpose: "COST_DISCOVERY", product: product.data.nombre,
      quote_type: "RFQ", observations: "Evidencia de precio PREBID: sin compra ni adjudicación automática" },
      [{ producto_id: pid, descripcion: product.data.nombre, unidad: product.data.unidad, cantidad: need.cantidad }], vendors);
    revalidatePath(workspacePath(context)); return rfq;
  });
}
export async function savePrebidSettingsAction(tenderId: string, raw: unknown) {
  return result(async () => {
    const { context, db, profile } = await access({ kind: "TENDER", id: tenderId }, true);
    const settings = costSettingsSchema.parse(raw); await ensureOffer(db, context, profile.empresa_id, profile.id);
    const r = await db.from("licitacion_ofertas").update({ cost_settings: settings }).eq("licitacion_id", tenderId).eq("empresa_id", profile.empresa_id).eq("estado", "BORRADOR").select("id").single();
    if (r.error) throw new Error(r.error.message); revalidatePath(workspacePath(context)); return true;
  });
}
export async function savePrebidVersionAction(tenderId: string, present: boolean, expectedHash: string) {
  return result(async () => {
    const { context, db, profile } = await access({ kind: "TENDER", id: tenderId }, true);
    const r = await db.rpc("prebid_workspace", { p_tender_id: tenderId });
    if (r.error) throw new Error(r.error.message);
    if (r.data.hash !== expectedHash) throw new Error("El workspace cambió. Actualizá antes de confirmar.");
    const costs = computeWorkspaceCosts(r.data.facts);
    if (!costs.complete || !costs.offer) throw new Error("Completá cantidades, APU y evidencia de precios antes de versionar/presentar.");
    // The browser supplies neither actor nor amount. This restricted RPC rechecks
    // the active actor, tenant, draft and factual hash under the tender lock.
    const saved = await createAdminClient().rpc("prebid_commit_version", { p_tender_id: tenderId,
      p_actor_id: profile.id, p_empresa_id: profile.empresa_id, p_present: z.boolean().parse(present),
      p_expected_hash: expectedHash, p_offer_amount: costs.offer.offerAmount });
    if (saved.error) throw new Error(saved.error.message); revalidatePath(workspacePath(context)); return saved.data;
  });
}
export async function recordPrebidOutcomeAction(tenderId: string, state: "GANADA"|"PERDIDA", amount?: number) {
  return result(async () => {
    const { context, db } = await access({ kind: "TENDER", id: tenderId });
    z.enum(["GANADA","PERDIDA"]).parse(state);
    if (state === "GANADA") z.number().finite().positive().max(1e15).parse(amount);
    const r = await db.rpc("prebid_record_outcome", { p_tender_id: tenderId, p_estado: state, p_awarded_amount: state === "GANADA" ? amount : null });
    if (r.error) throw new Error(r.error.message); revalidatePath(workspacePath(context)); revalidatePath(`/licitaciones/${tenderId}`); return r.data;
  });
}
export async function getWorkspaceBimUploadAction(raw: WorkspaceContext, name: string) {
  return result(async () => {
    const { context } = await access(raw, true);
    await requirePlan("caterpillar", ["comercial","administracion","admin"]);
    const safe = z.string().min(1).max(200).parse(name).replace(/[^a-zA-Z0-9.\-_]/g,"_");
    return { storagePath: `${context.kind === "TENDER" ? "tenders/" : ""}${context.id}/${randomUUID()}-${safe}` };
  });
}
export async function registerWorkspaceBimAction(raw: WorkspaceContext, fileName: string, storagePath: string, schema: string|null, elements: unknown[]) {
  return result(async () => {
    const { context, db } = await access(raw, true); await requirePlan("caterpillar", ["comercial","administracion","admin"]);
    if (!elements.length || elements.length>50000) throw new Error("IFC sin elementos válidos o demasiado grande.");
    const r = await db.rpc("workspace_register_bim", { p_context: context, p_file_name: fileName, p_storage_path: storagePath, p_schema: schema, p_elements: elements });
    if (r.error) throw new Error(r.error.message); revalidatePath(workspacePath(context)); return r.data;
  });
}
export async function applyWorkspaceBimQuantityAction(raw: WorkspaceContext, budgetItemId: string, elementIds: string[]) {
  return result(async () => {
    const { context, db } = await access(raw, true); await requirePlan("caterpillar", ["comercial","administracion","admin"]);
    const ids = z.array(z.uuid()).min(1).max(50000).parse(elementIds);
    const [b, e] = await Promise.all([
      db.from("budget_items").select("*").eq("id", z.uuid().parse(budgetItemId)).eq(ownerColumn(context), context.id).single(),
      db.from("bim_elements").select("*").eq(ownerColumn(context), context.id).in("id", ids),
    ]);
    if (b.error || e.error || e.data?.length!==new Set(ids).size) throw new Error("BIM o partida de otro contexto.");
    const aggregate = aggregateElementsForBudgetItem(e.data as BimElement[], b.data as BudgetItem);
    if (aggregate.incompatible.length || aggregate.compatible.length!==ids.length || !aggregate.totalQuantity || aggregate.totalQuantity<=0) throw new Error("Cantidades BIM ausentes o unidades incompatibles.");
    const r = await db.rpc("workspace_apply_bim_quantity", { p_context: context, p_budget_id: budgetItemId,
      p_elements: ids, p_expected_version: b.data.updated_at, p_quantity: aggregate.totalQuantity });
    if (r.error) throw new Error(r.error.message); revalidatePath(workspacePath(context)); return r.data;
  });
}
