import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

function csvField(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET() {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();

  const [{ data: productos }, { data: categorias }] = await Promise.all([
    supabase
      .from("productos")
      .select("nombre, sku, unidad, categoria_id, descripcion, stock_minimo, activo")
      .eq("empresa_id", profile.empresa_id)
      .order("nombre"),
    supabase.from("categorias_producto").select("id, nombre").eq("empresa_id", profile.empresa_id),
  ]);

  const catById = new Map((categorias ?? []).map((c: { id: string; nombre: string }) => [c.id, c.nombre]));

  const header = [
    "Material",
    "Código",
    "Unidad",
    "Categoría",
    "Descripción",
    "Stock mínimo",
    "Activo",
  ];

  const rows = (productos ?? []).map((p: {
    nombre: string;
    sku: string | null;
    unidad: string;
    categoria_id: string | null;
    descripcion: string | null;
    stock_minimo: number | null;
    activo: boolean;
  }) => [
    p.nombre,
    p.sku ?? "",
    p.unidad,
    p.categoria_id ? (catById.get(p.categoria_id) ?? "") : "",
    p.descripcion ?? "",
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
