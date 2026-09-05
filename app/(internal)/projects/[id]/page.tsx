import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { BackButton } from "@/components/ui/back-button";
import { Project, BudgetItem, ExecutionEntry, AuthorizedOrder } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/format";
import { AddBudgetItemForm } from "./add-budget-item-form";
import { ImportBudgetDialog } from "./import-budget-dialog";
import { DuplicateBudgetDialog } from "./duplicate-budget-dialog";
import { AddExecutionEntryForm } from "./add-execution-entry-form";
import { ProjectStatusSelect } from "./project-status-select";
import { ProjectGantt } from "./project-gantt";
import { ProjectReports } from "./reports";
import { ExecutionPhotosLightbox } from "./execution-photos-lightbox";
import { DailyLaborEntry, Subcontractor, SubcontractorContract, SubcontractorCertificate } from "@/lib/types";
import { AddLaborEntryForm } from "./add-labor-entry-form";
import { AddSubcontractorContractDialog } from "./add-subcontractor-contract-dialog";

const BASE_TABS = [
  { key: "presupuesto", label: "Presupuesto" },
  { key: "cronograma", label: "Cronograma" },
  { key: "ejecucion", label: "Ejecución" },
  { key: "compras", label: "Compras" },
  { key: "informes", label: "Informes" },
] as const;

// Caterpillar agrega Personal y Subcontratistas — no visibles en Pro.
const CATERPILLAR_TABS = [
  { key: "personal", label: "Personal" },
  { key: "subcontratistas", label: "Subcontratistas" },
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
  const isCaterpillar = profile.plan === "caterpillar";
  const TABS = isCaterpillar ? [...BASE_TABS, ...CATERPILLAR_TABS] : BASE_TABS;
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

  const [{ data: budgetItems }, { data: execEntries }, { data: orders }, { data: laborEntries }] = await Promise.all([
    supabase.from("budget_items").select("*").eq("project_id", id).order("sort_order").returns<BudgetItem[]>(),
    supabase.from("execution_entries").select("*").eq("project_id", id).order("entry_date", { ascending: false }).returns<ExecutionEntry[]>(),
    supabase.from("authorized_orders").select("*").eq("project_id", id).order("authorized_at", { ascending: false }).returns<AuthorizedOrder[]>(),
    isCaterpillar
      ? supabase.from("daily_labor_entries").select("*").eq("project_id", id).order("entry_date", { ascending: false }).returns<DailyLaborEntry[]>()
      : Promise.resolve({ data: [] as DailyLaborEntry[] }),
  ]);

  let subcontractorCatalog: Subcontractor[] = [];
  let contracts: SubcontractorContract[] = [];
  let certificates: SubcontractorCertificate[] = [];
  if (isCaterpillar) {
    const [{ data: subs }, { data: contractRows }] = await Promise.all([
      supabase.from("subcontractors").select("*").eq("empresa_id", empresaId).order("name").returns<Subcontractor[]>(),
      supabase.from("subcontractor_contracts").select("*").eq("project_id", id).order("created_at", { ascending: false }).returns<SubcontractorContract[]>(),
    ]);
    subcontractorCatalog = subs ?? [];
    contracts = contractRows ?? [];
    if (contracts.length > 0) {
      const { data: certRows } = await supabase
        .from("subcontractor_certificates")
        .select("*")
        .in("contract_id", contracts.map((c) => c.id))
        .returns<SubcontractorCertificate[]>();
      certificates = certRows ?? [];
    }
  }

  const items = budgetItems ?? [];
  const entries = execEntries ?? [];
  const ocs = orders ?? [];
  const laborRows = laborEntries ?? [];
  const laborHoursTotal = laborRows.reduce((s, l) => s + l.hours, 0);
  const laborCostTotal = laborRows.reduce((s, l) => s + l.labor_cost, 0);

  // Por contrato: suma de certificados aprobados/pagados + los pendientes,
  // para la alerta de techo (>90% del monto contratado entre aprobado y
  // pendiente cuenta como riesgo, no solo lo ya aprobado).
  const certsByContract = new Map<string, SubcontractorCertificate[]>();
  for (const c of certificates) {
    const list = certsByContract.get(c.contract_id) ?? [];
    list.push(c);
    certsByContract.set(c.contract_id, list);
  }
  function contractSummary(contractId: string) {
    const certs = certsByContract.get(contractId) ?? [];
    const approvedAmount = certs
      .filter((c) => c.status === "APROBADO" || c.status === "PAGADO")
      .reduce((s, c) => s + (c.approved_amount ?? 0), 0);
    const pendingAmount = certs
      .filter((c) => c.status === "PENDIENTE")
      .reduce((s, c) => s + c.claimed_amount, 0);
    const retentionAccum = certs
      .filter((c) => c.status === "APROBADO" || c.status === "PAGADO")
      .reduce((s, c) => s + c.retention_amount, 0);
    return { approvedAmount, pendingAmount, retentionAccum, certCount: certs.length };
  }

  // Proyectos candidatos para "Copiar de otro proyecto" — solo se ofrece si
  // este proyecto todavía no tiene ítems (no ensuciar un presupuesto ya armado).
  let duplicateSources: { id: string; code: string; name: string; itemCount: number }[] = [];
  if (items.length === 0) {
    const { data: otherProjects } = await supabase
      .from("projects")
      .select("id, code, name")
      .eq("empresa_id", empresaId)
      .neq("id", id)
      .returns<Pick<Project, "id" | "code" | "name">[]>();
    const otherIds = (otherProjects ?? []).map((p) => p.id);
    const { data: otherItems } = otherIds.length > 0
      ? await supabase.from("budget_items").select("project_id").in("project_id", otherIds)
      : { data: [] };
    const countByProject = new Map<string, number>();
    for (const b of otherItems ?? []) {
      countByProject.set(b.project_id as string, (countByProject.get(b.project_id as string) ?? 0) + 1);
    }
    duplicateSources = (otherProjects ?? [])
      .map((p) => ({ ...p, itemCount: countByProject.get(p.id) ?? 0 }))
      .filter((p) => p.itemCount > 0);
  }

  const execByItem = new Map<string, number>();
  for (const e of entries) {
    execByItem.set(e.budget_item_id, (execByItem.get(e.budget_item_id) ?? 0) + e.quantity_executed);
  }

  // URLs firmadas para las fotos — el bucket es privado, no hay URL pública.
  const allPhotoPaths = entries.flatMap((e) => e.photo_paths);
  const photoUrlByPath = new Map<string, string>();
  if (allPhotoPaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from("execution-photos")
      .createSignedUrls(allPhotoPaths, 3600);
    for (const s of signed ?? []) {
      if (s.signedUrl) photoUrlByPath.set(s.path ?? "", s.signedUrl);
    }
  }

  const itemsSubtotal = items.reduce((s, i) => s + i.subtotal, 0);
  // KPI y % de compras usan "el mayor" (estimado inicial vs. ítems reales),
  // mismo criterio que el dashboard general — la tabla de ítems sigue usando
  // itemsSubtotal puro, porque su fila TOTAL debe ser la suma de lo listado.
  const presupuestoTotal = Math.max(project.budget_total, itemsSubtotal);
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

      <div className={`grid gap-3 ${isCaterpillar ? "grid-cols-4" : "grid-cols-3"}`}>
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
        {isCaterpillar ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3.5">
            <div className="text-[11px] text-[var(--muted)] uppercase tracking-wide">Costo M. de Obra</div>
            <div className="text-[16px] font-bold mt-1">{formatMoney(laborCostTotal, "PYG")}</div>
            <div className="text-[11px] text-[var(--muted)] mt-0.5">{laborHoursTotal} h totales</div>
          </div>
        ) : null}
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
          <div className="flex flex-wrap gap-2">
            <AddBudgetItemForm projectId={project.id} />
            <ImportBudgetDialog projectId={project.id} />
            <DuplicateBudgetDialog targetProjectId={project.id} sources={duplicateSources} />
          </div>
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
                    <td className="num font-semibold">{formatMoney(itemsSubtotal, "PYG")}</td>
                    <td></td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </div>
      ) : null}

      {tab === "cronograma" ? (
        <ProjectGantt projectId={project.id} budgetItems={items} execEntries={entries} />
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
                  <th>Fotos</th>
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 ? (
                  <tr><td colSpan={5} className="text-center text-[var(--muted)] py-6">Sin avance registrado.</td></tr>
                ) : (
                  entries.map((e) => {
                    const item = items.find((i) => i.id === e.budget_item_id);
                    const photoUrls = e.photo_paths.map((p) => photoUrlByPath.get(p)).filter((u): u is string => !!u);
                    return (
                      <tr key={e.id}>
                        <td>{formatDate(e.entry_date)}</td>
                        <td>{item ? `${item.code} — ${item.description}` : "—"}</td>
                        <td className="num">{e.quantity_executed} {item?.unit ?? ""}</td>
                        <td className="text-[var(--muted)]">{e.notes ?? "—"}</td>
                        <td><ExecutionPhotosLightbox urls={photoUrls} /></td>
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
        <ProjectReports project={project} budgetItems={items} execEntries={entries} orders={ocs} />
      ) : null}

      {tab === "personal" && isCaterpillar ? (
        <div className="space-y-3">
          <AddLaborEntryForm projectId={project.id} />
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Trabajador</th>
                  <th className="num">Horas</th>
                  <th className="num">Costo/hora</th>
                  <th className="num">Total</th>
                  <th>Tarea</th>
                </tr>
              </thead>
              <tbody>
                {laborRows.length === 0 ? (
                  <tr><td colSpan={6} className="text-center text-[var(--muted)] py-6">Sin partes diarios registrados.</td></tr>
                ) : (
                  laborRows.map((l) => (
                    <tr key={l.id}>
                      <td>{formatDate(l.entry_date)}</td>
                      <td className="font-medium">{l.worker_name}</td>
                      <td className="num">{l.hours}</td>
                      <td className="num">{formatMoney(l.hourly_cost, "PYG")}</td>
                      <td className="num font-medium">{formatMoney(l.labor_cost, "PYG")}</td>
                      <td className="text-[var(--muted)]">{l.task_description ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {laborRows.length > 0 ? (
                <tfoot>
                  <tr>
                    <td colSpan={2} className="text-right font-semibold">TOTAL</td>
                    <td className="num font-semibold">{laborHoursTotal}</td>
                    <td></td>
                    <td className="num font-semibold">{formatMoney(laborCostTotal, "PYG")}</td>
                    <td></td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </div>
      ) : null}

      {tab === "subcontratistas" && isCaterpillar ? (
        <div className="space-y-3">
          <AddSubcontractorContractDialog
            projectId={project.id}
            subcontractors={subcontractorCatalog}
            budgetItems={items}
          />
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
            <table>
              <thead>
                <tr>
                  <th>Subcontratista</th>
                  <th>Rubro</th>
                  <th className="num">Contratado</th>
                  <th className="num">Certificado aprobado</th>
                  <th className="num">Retención acum.</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {contracts.length === 0 ? (
                  <tr><td colSpan={6} className="text-center text-[var(--muted)] py-6">Sin contratos cargados.</td></tr>
                ) : (
                  contracts.map((c) => {
                    const sub = subcontractorCatalog.find((s) => s.id === c.subcontractor_id);
                    const item = items.find((i) => i.id === c.budget_item_id);
                    const summary = contractSummary(c.id);
                    const usedPct = c.contracted_amount > 0
                      ? Math.round(((summary.approvedAmount + summary.pendingAmount) / c.contracted_amount) * 100)
                      : 0;
                    return (
                      <tr key={c.id}>
                        <td className="font-medium">{sub?.name ?? "—"}</td>
                        <td className="text-[var(--muted)]">{item ? `${item.code} — ${item.description}` : "—"}</td>
                        <td className="num">{formatMoney(c.contracted_amount, "PYG")}</td>
                        <td className="num">{formatMoney(summary.approvedAmount, "PYG")}</td>
                        <td className="num text-[var(--muted)]">{formatMoney(summary.retentionAccum, "PYG")}</td>
                        <td>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] text-[var(--muted)]">{c.status}</span>
                            {usedPct > 90 ? (
                              <span
                                className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-[var(--error-bg)] text-[var(--error)]"
                                title={`${usedPct}% del monto contratado entre aprobado y pendiente`}
                              >
                                ⚠ {usedPct}%
                              </span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
