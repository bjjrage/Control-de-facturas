import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { CategoriaProducto, Producto } from "@/lib/types";
import { StockSection } from "./stock-section";

export default async function StockPage() {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();

  const [{ data: productos }, { data: categorias }] = await Promise.all([
    supabase.from("productos")
      .select("id, empresa_id, nombre, descripcion, unidad, contenido_por_unidad, unidad_base, sku, categoria_id, stock_minimo, activo, created_by, created_at, updated_at")
      .eq("empresa_id", profile.empresa_id)
      .order("nombre")
      .returns<Producto[]>(),
    supabase
      .from("categorias_producto")
      .select("*")
      .eq("empresa_id", profile.empresa_id)
      .order("orden")
      .order("nombre")
      .returns<CategoriaProducto[]>(),
  ]);

  return (
    <StockSection
      productos={productos ?? []}
      categorias={categorias ?? []}
    />
  );
}
