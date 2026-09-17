// lib/tools/procurement/get-rfq-responses.ts
// READ tool LEVEL 0 — Get RFQ responses/cotizaciones received for a given RFQ.
// No duplica lógica: consulta tabla de respuestas con scoping tenant.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";

export const GetRfqResponsesInputSchema = z.object({
  rfq_id: z.string().uuid({ message: "rfq_id debe ser UUID valido" }),
});

export type GetRfqResponsesInput = z.infer<typeof GetRfqResponsesInputSchema>;

export interface GetRfqResponse {
  supplier_id: string;
  supplier_nombre: string;
  supplier_ruc: string | null;
  precio_oferta_pyg: number | null;
  moneda?: string;
  validez_hasta?: string;
  items_cubiertos: Array<{
    rfq_item_id: string;
    descripcion: string;
    cantidad_ofrecida: number;
    precio_unitario: number | null;
    cubre_item: boolean;
  }>;
  observaciones?: string;
  fecha_respuesta: string;
  estado: string; // ACCEPTED, REJECTED, COUNTER_OFFER, PENDING
}

export interface GetRfqResponsesOutput {
  rfq_id: string;
  respuestas: Array<GetRfqResponse>;
  total_respuestas: number;
  resumen_precios: {
    precio_minimo: number | null;
    precio_maximo: number | null;
    precio_promedio: number | null;
    monedas: string[];
  };
}

async function handler(
  ctx: AgentToolContext,
  input: GetRfqResponsesInput,
  deps: { db: SupabaseClient }
): Promise<GetRfqResponsesOutput> {
  const { db } = deps;
  const empresaId = ctx.empresaId;

  // 1. Obtener respuestas de la RFQ
  const { data: responses, error: respErr } = await db
    .from("rfq_responses")
    .select(`
      id,
      supplier_id,
      precio_oferta_pyg,
      moneda,
      validez_hasta,
      observaciones,
      fecha_respuesta,
      estado,
      rfq_items!inner(id, descripcion),
      suppliers!inner(nombre, ruc)
    `)
    .eq("rfq_id", input.rfq_id);

  if (respErr) throw new Error(`Error leyendo respuestas RFQ: ${respErr.message}`);

  // 2. Formatear respuestas
  const formattedResponses = (responses ?? []).map((r: any) => {
    // Obtener items cubiertos para esta respuesta
    const itemsCubiertos = (r.rfq_items ?? []).map((item: any) => ({
      rfq_item_id: item.id,
      descripcion: item.descripcion,
      cantidad_ofrecida: item.cantidad_ofrecida ?? 0,
      precio_unitario: item.precio_unitario ?? null,
      cubre_item: item.cubre_item ?? false,
    }));

    return {
      supplier_id: r.supplier_id,
      supplier_nombre: r.suppliers?.nombre || "Proveedor desconocido",
      supplier_ruc: r.suppliers?.ruc || null,
      precio_oferta_pyg: r.precio_oferta_pyg,
      moneda: r.moneda,
      fecha_respuesta: r.fecha_respuesta,
      estado: r.estado,
      items_cubiertos: itemsCubiertos,
    } as GetRfqResponse;
  });

  // 3. Resumen de precios
  const precios = formattedResponses.map((r) => r.precio_oferta_pyg).filter((p: number | null) => p !== null);
  const precio_minimo = precios.length > 0 ? Math.min(...precios) : null;
  const precio_maximo = precios.length > 0 ? Math.max(...precios) : null;
  const precio_promedio = precios.length > 0
    ? Number((precios.reduce((a, b) => a + b, 0) / precios.length).toFixed(2))
    : null;
  const monedas = [...new Set(formattedResponses.map((r) => r.moneda).filter((m: string | undefined): m is string => Boolean(m)))];

  return {
    rfq_id: input.rfq_id,
    respuestas: formattedResponses,
    total_respuestas: formattedResponses.length,
    resumen_precios: {
      precio_minimo,
      precio_maximo,
      precio_promedio,
      monedas,
    },
  };
}

// Auto-registro (side-effect al importar). Risk 0 = READ.
registerTool<GetRfqResponsesInput, GetRfqResponsesOutput>({
  name: "get_rfq_responses",
  description:
    "Obtiene las respuestas/cotizaciones recibidas para una RFQ por ID. Retorna ofertas de proveedores con precios, items cubiertos y estado de respuesta. Usar cuando el agente necesita 'ver las propuestas de la RFQ' o 'comparar cotizaciones'.",
  inputSchema: GetRfqResponsesInputSchema,
  riskLevel: 0,
  requiredRoles: null,
  handler,
});

// Export para tests / uso directo sin registry
export const getRfqResponsesTool = { handler, inputSchema: GetRfqResponsesInputSchema };