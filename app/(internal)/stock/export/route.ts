import { requireModule } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

function csvField(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET() {
  await requireModule("compras", ["administracion", "admin"]);
  const supabase = await createClient();

  const [{ data: productos }, { data: categorias }] = await Promise.all([
    supabase
      .from("productos")
      .select("nombre, sku, unidad, categoria_id, precio_venta, costo_promedio, stock_actual, stock_minimo, activo")
      .order("nombre"),
    supabase.from("categorias_producto").select("id, nombre"),
  ]);

  const catById = new Map((categorias ?? []).map((c: { id: string; nombre: string }) => [c.id, c.nombre]));

  const header = [
    "Nombre",
    "SKU",
    "Unidad",
    "Categoría",
    "Precio venta",
    "Costo promedio",
    "Stock actual",
    "Stock mínimo",
    "Activo",
  ];

  const rows = (productos ?? []).map((p: {
    nombre: string;
    sku: string | null;
    unidad: string;
    categoria_id: string | null;
    precio_venta: number | null;
    costo_promedio: number | null;
    stock_actual: number | null;
    stock_minimo: number | null;
    activo: boolean;
  }) => [
    p.nombre,
    p.sku ?? "",
    p.unidad,
    p.categoria_id ? (catById.get(p.categoria_id) ?? "") : "",
    p.precio_venta ?? "",
    p.costo_promedio ?? "",
    p.stock_actual ?? 0,
    p.stock_minimo ?? 0,
    p.activo ? "Sí" : "No",
  ]);

  const csv = [header, ...rows].map((row) => row.map(csvField).join(";")).join("\r\n");
  const date = new Date().toISOString().slice(0, 10);
  return new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="stock-${date}.csv"`,
    },
  });
}
