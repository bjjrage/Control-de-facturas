import type { WeeklyPlanCalculationSummary } from "@/lib/types";
import type { BudgetItemMaterialInput, StockDisponibilidadInput } from "./progress-forecast-engine";
import type { MrpPreviewResult } from "@/app/(internal)/projects/weekly-plan-actions";
import { loadCentralAvailability } from "./weekly-plan-shared";
import { allocateMaterialCoverage, isTimelyInbound } from "./mrp-coverage";
export async function buildMrpPreview(
  supabase: { from: (table: string) => any },
  empresaId: string,
  calculation: WeeklyPlanCalculationSummary,
  materialsByItem: Record<string, BudgetItemMaterialInput[]>,
  baseData: {
    stockAndInbound: Record<string, StockDisponibilidadInput>;
    inboundDetails: { producto_id: string; net_quantity: number; expected_delivery_date: string | null }[] | null;
  },
  neededBy: string
): Promise<MrpPreviewResult> {
  if (calculation.unconfigured_materials_count > 0) throw new Error("Configure el BOM de todas las metas antes de calcular cobertura o compras.");
  // Nombres/unidades para filas sin BOM propio (ej. inbound sin demanda).
  const names = new Map<string, { nombre: string; unidad: string }>();
  for (const list of Object.values(materialsByItem)) {
    for (const m of list) {
      if (!names.has(m.producto_id)) {
        names.set(m.producto_id, { nombre: m.producto_nombre, unidad: m.unidad_medida });
      }
    }
  }

  // Central disponible (físico − reservas ACTIVE). Sin central → ceros.
  // Si la lectura FALLA, se propaga el error (la UI avisa en vez de
  // mostrar ceros como "sin stock").
  const centralRes = await loadCentralAvailability(supabase, empresaId, {planId: calculation.plan_id, unitsByProduct: Object.fromEntries([...names].map(([id,v])=>[id,v.unidad]))});
  if (centralRes.error) throw new Error(centralRes.error);
  if (baseData.inboundDetails === null) throw new Error("No se pudo verificar el suministro entrante.");
  const centralAvailable = centralRes.data?.availableByProduct ?? {};
  const centralLocation = centralRes.data?.location ?? null;
  const centralError = centralRes.error ?? null;

  // Inbound con regla de fecha: válido solo con fecha <= neededBy.
  // Sin detalle (columna ausente) o sin fecha → no confirmado, NO descuenta.
  const validInbound: Record<string, number> = {};
  const unconfirmed: MrpPreviewResult["unconfirmedInbound"] = [];
    for (const d of baseData.inboundDetails) {
      const onTime = isTimelyInbound(d.expected_delivery_date, neededBy);
      if (onTime) {
        validInbound[d.producto_id] = (validInbound[d.producto_id] || 0) + d.net_quantity;
      } else {
        const nm = names.get(d.producto_id);
        const prev = unconfirmed.find((u) => u.producto_id === d.producto_id);
        if (prev) prev.cantidad = Number((prev.cantidad + d.net_quantity).toFixed(4));
        else
          unconfirmed.push({
            producto_id: d.producto_id,
            producto_nombre: nm?.nombre || "Material",
            cantidad: Number(d.net_quantity.toFixed(4)),
          });
      }
    }

  const gross = calculation.items.flatMap((it) =>
    it.materials.map((m) => ({
      producto_id: m.producto_id,
      producto_nombre: m.producto_nombre,
      unidad_medida: m.unidad_medida,
      costo_unitario: m.costo_unitario,
      requerido: m.demanda_bruta,
      cubierto_obra: m.cubierto_por_stock,
    }))
  );

  const allocation = allocateMaterialCoverage({
    gross,
    centralAvailableByProduct: centralAvailable,
    validInboundByProduct: validInbound,
  });

  return {
    lines: allocation.lines,
    total_requerido_valor: allocation.total_requerido_valor,
    total_cubierto_obra_valor: allocation.total_cubierto_obra_valor,
    total_cubierto_central_valor: allocation.total_cubierto_central_valor,
    total_cubierto_inbound_valor: allocation.total_cubierto_inbound_valor,
    total_comprar_cantidad: allocation.total_comprar_cantidad,
    total_caja_adicional: allocation.total_caja_adicional,
    costos_pendientes: allocation.costos_pendientes,
    centralLocation,
    neededBy,
    centralError,
    unconfirmedInbound: unconfirmed,
  };
}

