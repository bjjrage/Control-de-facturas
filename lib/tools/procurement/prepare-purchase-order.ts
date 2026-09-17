// lib/tools/procurement/prepare-purchase-order.ts
// PREPARE tool LEVEL 1 — Transforms a selected RFQ quotation into a Purchase Order (OC) draft.
// Reutiliza datos ya existentes: supplier, project, items, prices, currency, delivery.
// El usuario NO debería volver a cargarlos.
// Preserva: rfq_id, quotation_id, project_id o equivalentes reales del modelo.
// No emite/emite OC final - sólo prepara draft reversible.
// Risk 1: puede escribir porque sólo prepara borrador, no emite definitivo.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";

export const PreparePurchaseOrderInputSchema = z.object({
  rfq_id: z.string().uuid({ message: "rfq_id debe ser UUID valido" }),
  selected_supplier_id: z.string().uuid({ message: "selected_supplier_id debe ser UUID valido" }),
  selected_price_pyg: z.number().optional().nullable(),
  selected_currency: z.string().default("Gs.").optional(),
  notes: z.string().optional(),
  idempotency_key: z.string().uuid().optional(),
});

export type PreparePurchaseOrderInput = z.infer<typeof PreparePurchaseOrderInputSchema>;

export interface PreparePurchaseOrderOutput {
  po_id: string;
  draft: {
    id: string;
    rfq_id: string;
    project_id: string;
    supplier_id: string;
    supplier_nombre: string;
    status: "DRAFT";
    items: Array<{
      item_id: string;
      description: string;
      quantity: number;
      unit: string | null;
      price_pyg: number | null;
      currency: string;
    }>;
    total_price_pyg: number | null;
    currency: string;
    required_by?: string | null;
    notes?: string | null;
    created_at: string;
    source_rfq_id: string;
    source_quotation_reference?: string | null;
  };
  message: string;
}

async function handler(
  ctx: AgentToolContext,
  input: PreparePurchaseOrderInput,
  deps: { db: SupabaseClient }
): Promise<PreparePurchaseOrderOutput> {
  const { db } = deps;
  const empresaId = ctx.empresaId;

  // 1. Validar RFQ existe y pertenece a empresa
  const { data: rfq, error: rfqErr } = await db
    .from("rfqs")
    .select(`
      id,
      proyecto_id,
      status,
      required_by,
      proyectos!inner(id, name, code)
    `)
    .eq("id", input.rfq_id)
    .eq("empresa_id", empresaId)
    .single();

  if (rfqErr || !rfq) {
    throw new Error(`RFQ no encontrado o no pertenece a tu empresa (id=${input.rfq_id})`);
  }

  if (rfq.status !== "DRAFT" && rfq.status !== "ACCEPTED") {
    throw new Error(`No se puede preparar OC desde RFQ con status "${rfq.status}". Solo DRAFT o ACCEPTED.`);
  }

  // 2. Validar supplier seleccionado pertenece a la RFQ
  const { data: supplierInRfq } = await db
    .from("rfq_suppliers")
    .select("supplier_id, suppliers!inner(nombre, ruc)")
    .eq("rfq_id", input.rfq_id)
    .eq("supplier_id", input.selected_supplier_id)
    .single();

  if (!supplierInRfq) {
    throw new Error(`Supplier ${input.selected_supplier_id} no está invitado a esta RFQ`);
  }

  // supabase-js tipa el embed !inner como arreglo; en many-to-one llega objeto.
  const inviteRow = supplierInRfq as unknown as {
    suppliers?: { nombre: string; ruc: string | null } | Array<{ nombre: string; ruc: string | null }> | null;
  };
  const inviteSupplier = Array.isArray(inviteRow.suppliers) ? inviteRow.suppliers[0] : inviteRow.suppliers;
  const supplierNombre = inviteSupplier?.nombre || "Proveedor desconocido";

  // 3. Obtener items de la RFQ y sus cotizaciones seleccionadas
  const { data: rfqItems, error: itemsErr } = await db
    .from("rfq_items")
    .select(`
      id,
      description,
      quantity,
      unit,
      rfq_responses!inner(supplier_id, precio_oferta_pyg, moneda)
    `)
    .eq("rfq_id", input.rfq_id);

  if (itemsErr) throw new Error(`Error leyendo items RFQ: ${itemsErr.message}`);

  // 4. Construir items del PO draft
  // Filtrar respuestas del supplier seleccionado
  const selectedSupplierItems = (rfqItems ?? []).map((item: any) => {
    const response = item.rfq_responses?.find(
      (r: any) => r.supplier_id === input.selected_supplier_id
    );

    return {
      item_id: item.id,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit || null,
      price_pyg: response?.precio_oferta_pyg ?? input.selected_price_pyg ?? null,
      currency: response?.moneda ?? input.selected_currency ?? "Gs.",
    };
  });

  // 5. Calcular total
  const totalPrice = selectedSupplierItems.reduce(
    (acc, item) => acc + (Number(item.price_pyg) || 0) * (item.quantity || 0),
    0
  );

  // 6. Aplicar idempotencia
  let idempotencyKey = input.idempotency_key;
  if (!idempotencyKey) {
    idempotencyKey = crypto.randomUUID();
  }

  // Verificar si ya existe un PO draft con misma key+rfq+empresa
  const { data: existingPo, error: existErr } = await db
    .from("purchase_order_drafts")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("rfq_id", input.rfq_id)
    .eq("selected_supplier_id", input.selected_supplier_id)
    .maybeSingle();

  if (existErr) throw new Error(`Error checking PO idempotency: ${existErr.message}`);

  if (existingPo) {
    // Ya existe - retornar el existente
    const { data: po } = await db
      .from("purchase_order_drafts")
      .select()
      .eq("id", existingPo.id)
      .single();

    return {
      po_id: existingPo.id,
      draft: {
        id: po.id,
        rfq_id: po.rfq_id,
        project_id: po.project_id,
        supplier_id: po.supplier_id,
        supplier_nombre: po.supplier_nombre,
        status: po.status,
        items: po.items,
        total_price_pyg: po.total_price_pyg,
        currency: po.currency,
        required_by: po.required_by,
        notes: po.notes,
        created_at: po.created_at,
        source_rfq_id: po.source_rfq_id,
        source_quotation_reference: po.source_quotation_reference,
      },
      message: "Purchase order draft existente retornado (idempotencia)",
    };
  }

  // 7. Crear nuevo PO draft
  const { data: newPo, error: poErr } = await db
    .from("purchase_order_drafts")
    .insert({
      empresa_id: empresaId,
      rfq_id: input.rfq_id,
      project_id: rfq.proyecto_id,
      supplier_id: input.selected_supplier_id,
      supplier_nombre: supplierNombre,
      status: "DRAFT",
      total_price_pyg: totalPrice,
      currency: input.selected_currency ?? "Gs.",
      required_by: rfq.required_by || null,
      notes: input.notes || null,
      idempotency_key: idempotencyKey,
      source_rfq_id: input.rfq_id,
      source_quotation_reference: null, // se llenaría si viene de cotización externa
    })
    .select()
    .single();

  if (poErr || !newPo) throw new Error(`Error creando PO draft: ${poErr?.message}`);

  // 8. Crear items del PO draft
  const { data: newPoItems, error: poItemsErr } = await db
    .from("purchase_order_draft_items")
    .insert(
      selectedSupplierItems.map((item: any) => ({
        purchase_order_draft_id: newPo.id,
        rfq_item_id: item.item_id,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit || null,
        price_pyg: item.price_pyg,
        currency: item.currency,
      }))
    )
    .select();

  if (poItemsErr) throw new Error(`Error creando items PO draft: ${poItemsErr.message}`);

  return {
    po_id: newPo.id,
    draft: {
      id: newPo.id,
      rfq_id: newPo.rfq_id,
      project_id: newPo.project_id,
      supplier_id: newPo.supplier_id,
      supplier_nombre: newPo.supplier_nombre,
      status: newPo.status,
      items: (newPoItems ?? []).map((pi: any) => ({
        item_id: pi.rfq_item_id,
        description: pi.description,
        quantity: pi.quantity,
        unit: pi.unit || null,
        price_pyg: pi.price_pyg,
        currency: pi.currency,
      })),
      total_price_pyg: newPo.total_price_pyg,
      currency: newPo.currency,
      required_by: newPo.required_by,
      notes: newPo.notes,
      created_at: newPo.created_at,
      source_rfq_id: newPo.source_rfq_id,
      source_quotation_reference: newPo.source_quotation_reference,
    },
    message: "Purchase order draft creado exitosamente",
  };
}

// Auto-registro (side-effect al importar). Risk 1 = PREPARE (puede escribir drafts PO).
registerTool<PreparePurchaseOrderInput, PreparePurchaseOrderOutput>({
  name: "prepare_purchase_order",
  description:
    "Transforma una cotización seleccionada de una RFQ en una Orden de Compra (OC) draft. SOLO prepara borrador reversible - no emite OC definitiva. Reutiliza datos: supplier, project, items y prices ya existentes en la RFQ. El usuario NO debería volver a cargarlos. Preserva rfq_id, supplier_id, project_id. Idempotente: misma key+RFQ+supplier retorna draft existente. Usar cuando el usuario dice 'vamos con proveedor B. Prepará la orden.'",
  inputSchema: PreparePurchaseOrderInputSchema,
  riskLevel: 1,
  requiredRoles: null,
  handler,
});

// Export para tests / uso directo sin registry
export const preparePurchaseOrderTool = { handler, inputSchema: PreparePurchaseOrderInputSchema };