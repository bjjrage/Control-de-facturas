import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { BackButton } from "@/components/ui/back-button";
import { Project, BudgetItem, ExecutionEntry, AuthorizedOrder } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/format";
import { AddBudgetItemForm } from "./add-budget-item-form";
import { AddExecutionEntryForm } from "./add-execution-entry-form";
import { ProjectStatusSelect } from "./project-status-select";

const TABS = [
  { key: "presupuesto", label: "Presupuesto" },
  { key: "cronograma", label: "Cronograma" },
  { key: "ejecucion", label: "Ejecución" },
  { key: "compras", label: "Compras" },
  { key: "informes", label: "Informes" },
] as const;

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const tab = TABS.some((t) => t.key === rawTab) ? rawTab! : "presupuesto";
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .eq("empresa_id", empresaId)
    .single<Project>();
  if (!project) notFound();

  const [{ data: budgetItems }, { data: execEntries }, { data: orders }] = await Promise.all([
    supabase.from("budget_items").select("*").eq("project_id", id).order("sort_order").returns<BudgetItem[]>(),
    supabase.from("execution_entries").select("*").eq("project_id", id).order("entry_date", { ascending: false }).returns<ExecutionEntry[]>(),
    supabase.from("authorized_orders").select("*").eq("project_id", id).order("authorized_at", { ascending: false }).returns<AuthorizedOrder[]>(),
  ]);

  const items = budgetItems ?? [];
  const entries = execEntries ?? [];
  const ocs = orders ?? [];

  const execByItem = new Map<string, number>();
  for (const e of entries) {
    execByItem.set(e.budget_item_id, (execByItem.get(e.budget_item_id) ?? 0) + e.quantity_executed);
  }

  const presupuestoTotal = items.reduce((s, i) => s + i.subtotal, 0);
  const comprasTotal = ocs.filter((o) => o.currency === "PYG").reduce((s, o) => s + o.total_price, 0);
  const comprasPct = presupuestoTotal > 0 ? Math.round((comprasTotal / presupuestoTotal) * 100) : 0;

  function tabHref(key: string) {
    return `/projects/${id}?tab=${key}`;
  }

  return (
    <div className="max-w-5xl space-y-5">
      <BackButton label="Volver a Proyectos" />

      <div className="flex items-start justify-between mt-1">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-[17px] font-semibold">{project.name}</h1>
            <span className="text-[12px] text-[var(--muted)] font-mono">{project.code}</span>
          </div>
          <p className="text-[13px] text-[var(--muted)]">
            {project.client ? `Cliente: ${project.client}` : "Sin cliente"}
            {project.location ? ` · ${project.location}` : ""}
          </p>
        </div>
        <ProjectStatusSelect projectId={project.id} status={project.status} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3.5">
          <div className="text-[11px] text-[var(--muted)] uppercase tracking-wide">Presupuesto total</div>
          <div className="text-[16px] font-bold mt-1">{formatMoney(presupuestoTotal, "PYG")}</div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3.5">
          <div className="text-[11px] text-[var(--muted)] uppercase tracking-wide">Compras realizadas</div>
          <div className={`text-[16px] font-bold mt-1 ${comprasPct > 100 ? "text-[var(--error)]" : ""}`}>
            {formatMoney(comprasTotal, "PYG")}
          </div>
          <div className="text-[11px] text-[var(--muted)] mt-0.5">{comprasPct}% del presupuesto</div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3.5">
          <div className="text-[11px] text-[var(--muted)] uppercase tracking-wide">Ítems / entradas de avance</div>
          <div className="text-[16px] font-bold mt-1">{items.length} / {entries.length}</div>
        </div>
      </div>

      <div className="border-b border-[var(--border)] flex gap-1">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={tabHref(t.key)}
            className={`px-3 py-2 text-[13px] font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? "border-[var(--primary)] text-[var(--foreground)]"
                : "border-transparent text-[var(--muted)] hover:text-[var(--foreground)]"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "presupuesto" ? (
        <div className="space-y-3">
          <AddBudgetItemForm projectId={project.id} />
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descripción</th>
                  <th>Unid.</th>
                  <th className="num">Cantidad</th>
                  <th className="num">P. Unit.</th>
                  <th className="num">Subtotal</th>
                  <th className="num">Ejecutado</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr><td colSpan={7} className="text-center text-[var(--muted)] py-6">Sin ítems todavía.</td></tr>
                ) : (
                  items.map((i) => {
                    const exec = execByItem.get(i.id) ?? 0;
                    const pct = i.quantity && i.quantity > 0 ? Math.min(100, Math.round((exec / i.quantity) * 100)) : null;
                    return (
                      <tr key={i.id}>
                        <td className="font-medium">{i.code}</td>
                        <td>{i.description}</td>
                        <td className="text-[var(--muted)]">{i.unit ?? "—"}</td>
                        <td className="num">{i.quantity ?? "—"}</td>
                        <td className="num">{i.unit_price != null ? formatMoney(i.unit_price, "PYG") : "—"}</td>
                        <td className="num font-medium">{formatMoney(i.subtotal, "PYG")}</td>
                        <td className="num text-[var(--muted)]">{pct !== null ? `${pct}%` : "—"}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {items.length > 0 ? (
                <tfoot>
                  <tr>
                    <td colSpan={5} className="text-right font-semibold">TOTAL</td>
                    <td className="num font-semibold">{formatMoney(presupuestoTotal, "PYG")}</td>
                    <td></td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </div>
      ) : null}

      {tab === "cronograma" ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] py-12 text-center text-[13px] text-[var(--muted)]">
          Cronograma Gantt — próximamente (Checkpoint 4).
        </div>
      ) : null}

      {tab === "ejecucion" ? (
        <div className="space-y-3">
          <AddExecutionEntryForm projectId={project.id} budgetItems={items} />
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Ítem</th>
                  <th className="num">Cant. ejecutada</th>
                  <th>Notas</th>
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 ? (
                  <tr><td colSpan={4} className="text-center text-[var(--muted)] py-6">Sin avance registrado.</td></tr>
                ) : (
                  entries.map((e) => {
                    const item = items.find((i) => i.id === e.budget_item_id);
                    return (
                      <tr key={e.id}>
                        <td>{formatDate(e.entry_date)}</td>
                        <td>{item ? `${item.code} — ${item.description}` : "—"}</td>
                        <td className="num">{e.quantity_executed} {item?.unit ?? ""}</td>
                        <td className="text-[var(--muted)]">{e.notes ?? "—"}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "compras" ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
          <table>
            <thead>
              <tr>
                <th>Código OC</th>
                <th>Producto</th>
                <th>Proveedor</th>
                <th className="num">Total</th>
                <th>Autorizada</th>
              </tr>
            </thead>
            <tbody>
              {ocs.length === 0 ? (
                <tr><td colSpan={5} className="text-center text-[var(--muted)] py-6">Sin OCs vinculadas.</td></tr>
              ) : (
                ocs.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/orders/${o.id}`} className="text-action font-medium">{o.code}</Link>
                    </td>
                    <td>{o.product}</td>
                    <td>{o.provider_name}</td>
                    <td className="num">{formatMoney(o.total_price, o.currency)}</td>
                    <td>{formatDate(o.authorized_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === "informes" ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] py-12 text-center text-[13px] text-[var(--muted)]">
          Gráficas y exportes — próximamente (Checkpoint 5).
        </div>
      ) : null}
    </div>
  );
}
