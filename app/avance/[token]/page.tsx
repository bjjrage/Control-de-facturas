import { notFound } from "next/navigation";
import Image from "next/image";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/format";
import { AvanceForm } from "./avance-form";

export default async function AvancePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();

  const { data: project } = await admin
    .from("projects")
    .select("id, name, code, client, status")
    .eq("execution_token", token)
    .maybeSingle();

  if (!project) notFound();

  const [{ data: budgetItems }, { data: recentEntries }] = await Promise.all([
    admin
      .from("budget_items")
      .select("id, code, description, unit, quantity")
      .eq("project_id", project.id)
      .not("unit", "is", null)
      .not("quantity", "is", null)
      .order("sort_order"),
    admin
      .from("execution_entries")
      .select("id, entry_date, quantity_executed, notes, budget_items(code, description, unit)")
      .eq("project_id", project.id)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const items = budgetItems ?? [];
  const isActive = project.status === "ACTIVO";

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-8">
      <div className="mx-auto w-full max-w-lg space-y-4">
        <Image src="/logo/niupack-wordmark.svg" alt="niupack" width={120} height={26} priority />

        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
          <p className="text-[11px] text-[var(--muted)] mb-1">Parte diario de avance</p>
          <h1 className="text-[15px] font-semibold mb-2">{project.name}</h1>
          <div className="space-y-1 text-[13px]">
            <div><span className="text-[var(--muted)]">Código: </span>{project.code}</div>
            {project.client ? <div><span className="text-[var(--muted)]">Cliente: </span>{project.client}</div> : null}
          </div>
        </div>

        {isActive ? (
          items.length > 0 ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
              <h2 className="text-[14px] font-semibold mb-3">Registrar avance de hoy</h2>
              <AvanceForm token={token} budgetItems={items} />
            </div>
          ) : (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5 text-[13px] text-[var(--muted)]">
              Todavía no hay ítems de presupuesto cargados en esta obra — pedile a la empresa que cargue el
              presupuesto antes de reportar avance.
            </div>
          )
        ) : (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5 text-[13px] text-[var(--muted)]">
            Esta obra no está activa ({project.status.toLowerCase()}) — no se puede cargar avance nuevo.
          </div>
        )}

        {(recentEntries ?? []).length > 0 ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
            <p className="text-[12px] font-semibold mb-2">Últimos partes cargados</p>
            <div className="space-y-2">
              {(recentEntries ?? []).map((e) => {
                const bi = (Array.isArray(e.budget_items) ? e.budget_items[0] : e.budget_items) as
                  | { code: string; description: string; unit: string | null }
                  | null;
                return (
                  <div key={e.id} className="text-[12px] border-b border-[var(--border)] pb-2 last:border-0 last:pb-0">
                    <div className="font-medium">
                      {bi ? `${bi.code} — ${bi.description}` : "Ítem eliminado"}
                    </div>
                    <div className="text-[var(--muted)]">
                      {formatDate(e.entry_date)} · {e.quantity_executed} {bi?.unit ?? ""}
                      {e.notes ? ` · ${e.notes}` : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
