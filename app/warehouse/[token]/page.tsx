import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashWarehousePortalToken } from "@/lib/inventory/portal";

export default async function WarehousePortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const { data: link } = await admin
    .from("warehouse_portal_links")
    .select("id, empresa_id, location_id, active, expires_at")
    .eq("token_hash", hashWarehousePortalToken(token))
    .maybeSingle();
  const now = new Date().getTime();
  if (!link || !link.active || (link.expires_at && new Date(link.expires_at).getTime() <= now)) notFound();
  const { data: location } = await admin
    .from("inventory_locations")
    .select("name, project_id, location_type")
    .eq("id", link.location_id)
    .eq("empresa_id", link.empresa_id)
    .maybeSingle();
  if (!location || location.location_type !== "PROJECT") notFound();

  return (
    <main className="min-h-screen bg-[var(--background)] px-4 py-8">
      <div className="mx-auto max-w-lg space-y-4">
        <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
          <p className="text-[11px] text-[var(--muted)]">Rendición de materiales</p>
          <h1 className="mt-1 text-lg font-semibold">{location.name}</h1>
          <p className="mt-2 text-[13px] text-[var(--muted)]">
            Subí las fotos semanales del cuaderno o una planilla. La empresa revisará la evidencia antes de afectar el stock.
          </p>
        </section>
        <form
          action={`/api/warehouse-portal/${encodeURIComponent(token)}`}
          method="post"
          encType="multipart/form-data"
          className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5"
        >
          <div className="grid grid-cols-2 gap-3">
            <label className="text-[12px]">
              Desde
              <input className="mt-1 block w-full rounded border p-2" type="date" name="period_start" required />
            </label>
            <label className="text-[12px]">
              Hasta
              <input className="mt-1 block w-full rounded border p-2" type="date" name="period_end" required />
            </label>
          </div>
          <label className="block text-[12px]">
            N° de remisión (opcional)
            <input className="mt-1 block w-full rounded border p-2" name="remision_number" />
          </label>
          <label className="block text-[12px]">
            Fotos o planilla
            <input className="mt-1 block w-full rounded border p-2" type="file" name="files" accept="image/*,.xlsx,.xls,.csv" multiple required />
          </label>
          <label className="block text-[12px]">
            Nota (opcional)
            <textarea className="mt-1 block w-full rounded border p-2" name="notes" rows={3} />
          </label>
          <button className="w-full rounded bg-[var(--foreground)] px-4 py-2 text-sm text-[var(--background)]" type="submit">
            Enviar evidencia
          </button>
        </form>
      </div>
    </main>
  );
}
