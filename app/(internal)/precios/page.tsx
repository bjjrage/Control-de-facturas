import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { buildPriceList, groupUnlinkedPurchases, type PriceListObservationInput } from "@/lib/costing/price-list";
import { PricesSection } from "./prices-section";
import { UnlinkedPurchases } from "./unlinked-purchases";

export default async function PreciosPage() {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;
  const today = new Date().toISOString().slice(0, 10);

  const [productsRes, categoriasRes, obsRes, unlinkedRes] = await Promise.all([
    supabase.from("productos").select("id, nombre, unidad, categoria_id, costo_promedio").eq("empresa_id", empresaId).eq("activo", true).order("nombre"),
    supabase.from("categorias_producto").select("id, nombre").eq("empresa_id", empresaId),
    supabase
      .from("cost_observations")
      .select("id, producto_id, fuente, documento_id, proveedor_id, cantidad, unidad, precio_unitario, fecha_observacion, es_volatil")
      .eq("empresa_id", empresaId)
      .eq("estado_evidencia", "VALIDA")
      .eq("categoria_insumo", "MATERIAL")
      .not("producto_id", "is", null)
      .not("precio_unitario", "is", null)
      .lte("fecha_observacion", today)
      .order("fecha_observacion", { ascending: false })
      .limit(10000),
    supabase
      .from("cost_observations")
      .select("descripcion_item, fuente, documento_id, precio_unitario, fecha_observacion")
      .eq("empresa_id", empresaId)
      .eq("estado_evidencia", "VALIDA")
      .eq("categoria_insumo", "MATERIAL")
      .is("producto_id", null)
      .not("precio_unitario", "is", null)
      .order("fecha_observacion", { ascending: false })
      .limit(3000),
  ]);

  const categoria = new Map((categoriasRes.data ?? []).map((c: any) => [c.id as string, c.nombre as string]));
  const observations: PriceListObservationInput[] = ((obsRes.data ?? []) as any[])
    .filter((o) => Number(o.precio_unitario) > 0 && Number(o.cantidad) > 0)
    .map((o) => ({
      id: o.id,
      productoId: o.producto_id,
      fuente: o.fuente,
      documentoId: o.documento_id ?? null,
      proveedorId: o.proveedor_id ?? null,
      cantidad: Number(o.cantidad),
      unidad: o.unidad,
      precio: Number(o.precio_unitario),
      fecha: o.fecha_observacion,
      esVolatil: !!o.es_volatil,
    }));

  const rows = buildPriceList(
    ((productsRes.data ?? []) as any[]).map((p) => ({
      id: p.id,
      nombre: p.nombre,
      unidad: p.unidad,
      rubro: p.categoria_id ? (categoria.get(p.categoria_id) ?? null) : null,
      costoPromedio: p.costo_promedio == null ? null : Number(p.costo_promedio),
    })),
    observations,
    today
  );

  const providerIds = [...new Set(rows.flatMap((r) => [r.ultimaCompra?.proveedorId, r.ultimaCotizacion?.proveedorId]).filter((x): x is string => !!x))];
  const providers: Record<string, string> = {};
  if (providerIds.length > 0) {
    const { data } = await supabase.from("providers").select("id, name").in("id", providerIds);
    for (const p of (data ?? []) as any[]) providers[p.id] = p.name;
  }

  const unlinked = groupUnlinkedPurchases(
    ((unlinkedRes.data ?? []) as any[])
      .filter((o) => Number(o.precio_unitario) > 0)
      .map((o) => ({ descripcion: o.descripcion_item, precio: Number(o.precio_unitario), fecha: o.fecha_observacion, fuente: o.fuente, documentoId: o.documento_id ?? null }))
  );
  const catalog = ((productsRes.data ?? []) as any[]).map((p) => ({ id: p.id as string, nombre: p.nombre as string }));

  return (
    <div className="space-y-6">
      <PricesSection rows={rows} providers={providers} />
      <div className="max-w-6xl">
        <UnlinkedPurchases purchases={unlinked} catalog={catalog} />
      </div>
    </div>
  );
}
