import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Producto, CategoriaProducto, Deposito } from "@/lib/types";
import { StockSection } from "./stock-section";

export default async function StockPage() {
  await requirePlan("pro");
  const supabase = await createClient();

  const [{ data: productos }, { data: categorias }, { data: depositos }] = await Promise.all([
    supabase.from("productos").select("*").order("nombre").returns<Producto[]>(),
    supabase
      .from("categorias_producto")
      .select("*")
      .order("orden")
      .order("nombre")
      .returns<CategoriaProducto[]>(),
    supabase
      .from("depositos")
      .select("*")
      .eq("activo", true)
      .order("es_principal", { ascending: false })
      .order("nombre")
      .returns<Deposito[]>(),
  ]);

  return (
    <StockSection
      productos={productos ?? []}
      categorias={categorias ?? []}
      depositos={depositos ?? []}
    />
  );
}
