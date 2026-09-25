import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatNumber } from "@/lib/format";
import { Button } from "@/components/ui/button";

export default async function MaterialDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const { data: material } = await supabase
    .from("productos")
    .select("id, nombre, descripcion, unidad, sku, categoria_id, stock_minimo, activo")
    .eq("id", id)
    .eq("empresa_id", profile.empresa_id)
    .maybeSingle();
  if (!material) notFound();

  const { data: categoria } = material.categoria_id
    ? await supabase
        .from("categorias_producto")
        .select("nombre")
        .eq("id", material.categoria_id)
        .eq("empresa_id", profile.empresa_id)
        .maybeSingle()
    : { data: null };

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href="/stock" className="text-action text-[12px] text-[var(--muted)]">← Volver a Materiales</Link>
          <div className="flex items-center gap-2 mt-1">
            <h1 className="text-[17px] font-semibold">{material.nombre}</h1>
            {!material.activo ? <span className="text-[11px] text-[var(--muted)] border border-[var(--border)] rounded px-1.5 py-0.5">Inactivo</span> : null}
          </div>
          <div className="flex items-center gap-2 mt-1">
            {material.sku ? <span className="text-[12px] text-[var(--muted)] font-mono">Código: {material.sku}</span> : null}
            {categoria?.nombre ? <span className="text-[11px] text-[var(--muted)] border border-[var(--border)] rounded px-1.5 py-0.5">{categoria.nombre}</span> : null}
          </div>
          {material.descripcion ? <p className="text-[12px] text-[var(--muted)] mt-1">{material.descripcion}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          {profile.role === "admin" ? (
            <Link href={`/stock/${material.id}/editar`}><Button variant="secondary" className="h-8 px-3 text-[12px]">Editar</Button></Link>
          ) : null}
          <Link href="/inventario"><Button variant="secondary" className="h-8 px-3 text-[12px]">Stock e Inventario</Button></Link>
        </div>
      </div>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 space-y-3">
        <h2 className="text-[13px] font-semibold">Datos del material</h2>
        <dl className="grid gap-3 sm:grid-cols-3 text-[12px]">
          <div><dt className="text-[var(--muted)]">Unidad</dt><dd className="mt-1">{material.unidad}</dd></div>
          <div><dt className="text-[var(--muted)]">Stock mínimo de referencia</dt><dd className="mt-1">{Number(material.stock_minimo) > 0 ? `${formatNumber(Number(material.stock_minimo), 2)} ${material.unidad}` : "No definido"}</dd></div>
          <div><dt className="text-[var(--muted)]">Estado</dt><dd className="mt-1">{material.activo ? "Activo" : "Inactivo"}</dd></div>
        </dl>
        <p className="text-[12px] text-[var(--muted)]">
          Esta ficha es el maestro de materiales; no representa existencias. El stock físico y sus movimientos se consultan en <Link href="/inventario" className="underline text-[var(--foreground)]">Stock e Inventario</Link>.
        </p>
      </section>

      {profile.role === "admin" ? (
        <div className="flex justify-end">
          {material.activo ? (
            <form action={async () => { "use server"; const { desactivarProducto } = await import("../stock-actions"); await desactivarProducto(id); }}>
              <button type="submit" className="text-[12px] text-[var(--muted)] hover:text-[var(--error)]">Desactivar material</button>
            </form>
          ) : (
            <form action={async () => { "use server"; const { reactivarProducto } = await import("../stock-actions"); await reactivarProducto(id); }}>
              <button type="submit" className="text-[12px] text-[var(--muted)] hover:text-[var(--ok)]">Reactivar material</button>
            </form>
          )}
        </div>
      ) : null}
    </div>
  );
}
