// lib/tools/procurement/get-rfq.ts
// READ tool LEVEL 0 — Get RFQ (Solicitud de Cotización) details by ID.
// No duplica lógica: lee RFQs tabla con scoping tenant estricto.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";

export const GetRfqInputSchema = z.object({
  rfq_id: z.string().uuid({ message: "rfq_id debe ser UUID valido" }),
});

export type GetRfqInput = z.infer<typeof GetRfqInputSchema>;

export interface GetRfqOutput {
  rfq: {
    id: string;
    proyecto_id: string;
    empresa_id: string;
    titulo: string;
    descripcion?: string;
    material_solicitado?: string;
    cantidad_solicitada?: number;
    unidad?: string;
    proyecto_nombre?: string;
    proyecto_codigo?: string;
    status: string;
    fecha_solicitud: string;
    fecha_limite?: string;
    presupuesto_referencial?: number;
    creado_por?: string;
  };
  items: Array<{
    id: string;
    descripcion: string;
    cantidad: number;
    unidad: string;
    requiere_aprobacion?: boolean;
  }>;
  suppliers_invited: Array<{
    supplier_id: string;
    nombre: string;
    ruc: string | null;
    estado_respuesta?: string;
  }>;
  created_at: string;
}

async function handler(
  ctx: AgentToolContext,
  input: GetRfqInput,
  deps: { db: SupabaseClient }
): Promise<GetRfqOutput> {
  const { db } = deps;
  const empresaId = ctx.empresaId;

  // 1. Obtener RFQ principal
  const { data: rfq, error: rfqErr } = await db
    .from("rfqs")
    .select(`
      id,
      proyecto_id,
      empresa_id,
      titulo,
      descripcion,
      material_solicitado,
      cantidad_solicitada,
      unidad,
      status,
      fecha_solicitud,
      fecha_limite,
      presupuesto_referencial,
      creado_por,
      projects!inner(id, name, code)
    `)
    .eq("id", input.rfq_id)
    .eq("empresa_id", empresaId)
    .single();

  if (rfqErr || !rfq) {
    throw new Error(`RFQ no encontrado o no pertenece a tu empresa (id=${input.rfq_id})`);
  }

  // 2. Obtener items de la RFQ
  const { data: rfqItems, error: itemsErr } = await db
    .from("rfq_items")
    .select("id, descripcion, cantidad, unidad")
    .eq("rfq_id", input.rfq_id);

  if (itemsErr) throw new Error(`Error leyendo items de RFQ: ${itemsErr.message}`);

  // 3. Obtener proveedores invitados y respuestas
  const { data: supplierInvitations, error: supErr } = await db
    .from("rfq_suppliers")
    .select(`
      supplier_id,
      suppliers!inner(nombre, ruc),
      estado_respuesta,
      responded_at
    `)
    .eq("rfq_id", input.rfq_id);

  if (supErr) throw new Error(`Error leyendo proveedores RFQ: ${supErr.message}`);

  return {
    rfq: {
      id: rfq.id,
      proyecto_id: rfq.proyecto_id,
      empresa_id: rfq.empresa_id,
      titulo: rfq.titulo,
      descripcion: rfq.descripcion,
      material_solicitado: rfq.material_solicitado,
      cantidad_solicitada: rfq.cantidad_solicitada,
      unidad: rfq.unidad,
      status: rfq.status,
      fecha_solicitud: rfq.fecha_solicitud,
      fecha_limite: rfq.fecha_limite,
      presupuesto_referencial: rfq.presupuesto_referencial,
      creado_por: rfq.creado_por,
      proyecto_nombre: rfq.projects?.name || null,
      proyecto_codigo: rfq.projects?.code || null,
    },
    items: (rfqItems ?? []) as Array<{
      id: string;
      descripcion: string;
      cantidad: number;
      unidad: string;
    }>,
    suppliers_invited: (supplierInvitations ?? []).map((si: any) => ({
      supplier_id: si.supplier_id,
      nombre: si.suppliers?.nombre || "Proveedor desconocido",
      ruc: si.suppliers?.ruc || null,
      estado_respuesta: si.estado_respuesta,
    })),
    created_at: rfq.created_at,
  };
}

// Auto-registro (side-effect al importar). Risk 0 = READ.
registerTool<GetRfqInput, GetRfqOutput>({
  name: "get_rfq",
  description:
    "Obtiene los detalles de una Solicitud de Cotización (RFQ) por ID: datos generales, items solicitados y proveedores invitados. Usar cuando el agente necesita consultar 'la RFQ del proyecto X' o 'estado de cotizaciones'.",
  inputSchema: GetRfqInputSchema,
  riskLevel: 0,
  requiredRoles: null,
  handler,
});

// Export para tests / uso directo sin registry
export const getRfqTool = { handler, inputSchema: GetRfqInputSchema };