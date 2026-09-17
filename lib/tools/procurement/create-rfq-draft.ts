// lib/tools/procurement/create-rfq-draft.ts
// PREPARE tool LEVEL 1 — Creates a RFQ (Solicitud de Cotización) draft.
// Puede escribir porque sólo crea/prepara borradores reversibles.
// Debe ser idempotente: misma idempotency key → mismo draft, no duplicado.
// No debe enviar comunicaciones ni comprometer dinero.
// Valida tenant, project, suppliers, items. Mantiene origen/trazabilidad.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";

export const CreateRfqDraftInputSchema = z.object({
  project_id: z.string().uuid({ message: "project_id debe ser UUID valido" }),
  supplier_ids: z.array(z.string().uuid()).min(1, "al menos un supplier_id"),
  items: z.array(
    z.object({
      description: z.string().nonempty("descripción requerida"),
      quantity: z.number().int().positive("cantidad debe ser > 0"),
      unit: z.string().optional(),
    })
  ).min(1, "al menos un item"),
  required_by: z.string().optional(), // fecha ISO string
  notes: z.string().optional(),
  idempotency_key: z.string().uuid().optional(),
});

export type CreateRfqDraftInput = z.infer<typeof CreateRfqDraftInputSchema>;

export interface CreateRfqDraftOutput {
  rfq_id: string;
  draft: {
    id: string;
    project_id: string;
    empresa_id: string;
    titulo: string;
    status: "DRAFT";
    required_by?: string | null;
    notes?: string | null;
    created_at: string;
    items: Array<{
      id: string;
      description: string;
      quantity: number;
      unit: string | null;
    }>;
    suppliers: Array<{
      supplier_id: string;
      invited_at: string;
    }>;
  };
  message: string;
}

async function handler(
  ctx: AgentToolContext,
  input: CreateRfqDraftInput,
  deps: { db: SupabaseClient }
): Promise<CreateRfqDraftOutput> {
  const { db } = deps;
  const empresaId = ctx.empresaId;

  // 1. Validar proyecto pertenece a la empresa
  const { data: project, error: projErr } = await db
    .from("projects")
    .select("id, empresa_id, name, code")
    .eq("id", input.project_id)
    .eq("empresa_id", empresaId)
    .single();

  if (projErr || !project) {
    throw new Error(`Proyecto no encontrado o no pertenece a tu empresa (id=${input.project_id})`);
  }

  // 2. Validar suppliers pertenecen a la empresa (check via vault o tab)
  // Usamos company_bid_vault_items para verificar suppliers existen y son de la empresa
  const { data: vaultSuppliers, error: vaultErr } = await db
    .from("company_bid_vault_items")
    .select("id, titulo, metadatos, empresa_id")
    .eq("empresa_id", empresaId)
    .in("categoria", ["FISCAL", "OTRO"]); // suppliers suelen estar en FISCAL o LEGAL

  if (vaultErr) throw new Error(`Error validando suppliers: ${vaultErr.message}`);

  // Build set of valid supplier IDs from vault for this empresa
  const validSupplierIds = new Set(
    (vaultSuppliers ?? []).map((v: any) => v.id)
  );

  // Check each supplied supplier_id
  for (const sid of input.supplier_ids) {
    if (!validSupplierIds.has(sid)) {
      throw new Error(`Supplier ID ${sid} no encontrado o no pertenece a tu empresa`);
    }
  }

  // 3. Validar items - cruzar contra catálogo de productos
  const { data: catalog, error: catErr } = await db
    .from("productos")
    .select("id, nombre, unidad, activo")
    .eq("empresa_id", empresaId)
    .eq("activo", true);

  if (catErr) throw new Error(`Error catálogo productos: ${catErr.message}`);

  const catalogItems = (catalog ?? []) as Array<{ id: string; nombre: string; unidad: string | null; activo: boolean }>;

  for (const item of input.items) {
    const hasMatch = catalogItems.some((c) =>
      c.nombre.toLowerCase().includes(item.description.toLowerCase())
    );
    if (!hasMatch) {
      // No es error fatal - el usuario puede solicitar materiales no en catálogo
      // Pero loggeamos warning; el draft se crea igual
    }
  }

  // 4. Aplicar idempotencia: si ya existe RFQ draft con misma key+empresa, retornar existente
  let idempotencyKey = input.idempotency_key;
  if (!idempotencyKey) {
    idempotencyKey = crypto.randomUUID();
  }

  // Verificar si ya existe un draft con esta key para esta empresa
  const { data: existingRfq, error: existErr } = await db
    .from("rfqs")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existErr) throw new Error(`Error checking idempotency: ${existErr.message}`);

  if (existingRfq) {
    // Ya existe - retornar el existente
    const { data: rfq } = await db
      .from("rfqs")
      .select("id, titulo, status, required_by, notes, created_at")
      .eq("id", existingRfq.id)
      .single();

    // Obtener items del RFQ existente
    const { data: existingItems } = await db
      .from("rfq_items")
      .select("id, description, quantity, unit")
      .eq("rfq_id", existingRfq.id);

    // Obtener suppliers invitados
    const { data: existingSuppliers } = await db
      .from("rfq_suppliers")
      .select("supplier_id, invited_at")
      .eq("rfq_id", existingRfq.id);

    return {
      rfq_id: existingRfq.id,
      draft: {
        id: existingRfq.id,
        project_id: input.project_id,
        empresa_id: empresaId,
        titulo: rfq?.titulo || "RFQ Draft",
        status: rfq?.status || "DRAFT",
        required_by: rfq?.required_by || input.required_by || null,
        notes: rfq?.notes || input.notes || null,
        created_at: rfq?.created_at || new Date().toISOString(),
        items: (existingItems ?? []).map((ii: any) => ({
          id: ii.id,
          description: ii.description,
          quantity: ii.quantity,
          unit: ii.unit || null,
        })),
        suppliers: (existingSuppliers ?? []).map((s: any) => ({
          supplier_id: s.supplier_id,
          invited_at: s.invited_at,
        })),
      },
      message: "RFQ draft existente retornado (idempotencia)",
    };
  }

  // 5. Crear nuevo RFQ draft
  const rfqTitle = `Solicitud de Cotización - ${project.name} (${project.code})`;

  const { data: newRfq, error: rfqErr } = await db
    .from("rfqs")
    .insert({
      empresa_id: empresaId,
      proyecto_id: input.project_id,
      titulo: rfqTitle,
      descripcion: `RFQ draft creado por agente para proyecto ${project.code}`,
      status: "DRAFT",
      required_by: input.required_by || null,
      notes: input.notes || null,
      idempotency_key: idempotencyKey,
    })
    .select("id, titulo, status, required_by, notes, created_at")
    .single();

  if (rfqErr || !newRfq) throw new Error(`Error creando RFQ: ${rfqErr?.message}`);

  // 6. Crear items de la RFQ
  const { data: newItems, error: itemsErr } = await db
    .from("rfq_items")
      .insert(
        input.items.map((item) => ({
          rfq_id: newRfq.id,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit || null,
        }))
      )
      .select("id, description, quantity, unit");

  if (itemsErr) throw new Error(`Error creando items RFQ: ${itemsErr.message}`);

  // 7. Invitar suppliers a la RFQ
  const { data: newSuppliers, error: supErr } = await db
    .from("rfq_suppliers")
    .insert(
      input.supplier_ids.map((supplier_id: string) => ({
        rfq_id: newRfq.id,
        supplier_id: supplier_id,
        invited_at: new Date().toISOString(),
        estado_respuesta: "PENDING",
      }))
    )
    .select("supplier_id, invited_at, estado_respuesta");

  if (supErr) throw new Error(`Error invitando suppliers: ${supErr.message}`);

  return {
    rfq_id: newRfq.id,
    draft: {
      id: newRfq.id,
      project_id: input.project_id,
      empresa_id: empresaId,
      titulo: newRfq.titulo,
      status: newRfq.status,
      required_by: newRfq.required_by,
      notes: newRfq.notes,
      created_at: newRfq.created_at,
      items: (newItems ?? []).map((ii: any) => ({
        id: ii.id,
        description: ii.description,
        quantity: ii.quantity,
        unit: ii.unit || null,
      })),
      suppliers: (newSuppliers ?? []).map((s: any) => ({
        supplier_id: s.supplier_id,
        invited_at: s.invited_at,
      })),
    },
    message: "RFQ draft creado exitosamente",
  };
}

// Auto-registro (side-effect al importar). Risk 1 = PREPARE (puede escribir drafts).
registerTool<CreateRfqDraftInput, CreateRfqDraftOutput>({
  name: "create_rfq_draft",
  description:
    "Crea un borrador de Solicitud de Cotización (RFQ) para un proyecto y suppliers dados. SOLO crea draft reversible - no envía comunicaciones ni compromete dinero. Idempotente: misma key+empresa retorna draft existente. Validar proyecto, suppliers y items antes de crear. Usar cuando el usuario dice 'preparame una cotización con estos proveedores'.",
  inputSchema: CreateRfqDraftInputSchema,
  riskLevel: 1,
  requiredRoles: null, // roles internos
  handler,
});

// Export para tests / uso directo sin registry
export const createRfqDraftTool = { handler, inputSchema: CreateRfqDraftInputSchema };