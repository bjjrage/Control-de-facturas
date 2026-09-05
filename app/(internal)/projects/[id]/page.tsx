import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { BackButton } from "@/components/ui/back-button";
import { Project, BudgetItem, ExecutionEntry, AuthorizedOrder } from "@/lib/types";
import { formatMoney } from "@/lib/format";
import { AddBudgetItemForm } from "./add-budget-item-form";
import { ImportBudgetDialog } from "./import-budget-dialog";
import { DuplicateBudgetDialog } from "./duplicate-budget-dialog";
import { AddExecutionEntryForm } from "./add-execution-entry-form";
import { ProjectStatusSelect } from "./project-status-select";
import { EditProjectDialog } from "./edit-project-dialog";
import { DeleteProjectButton } from "./delete-project-button";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProjectGantt } from "./project-gantt";
import { ProjectReports } from "./reports";
import { DailyLaborEntry, Subcontractor, SubcontractorContract, SubcontractorCertificate } from "@/lib/types";
import { AddLaborEntryForm } from "./add-labor-entry-form";
import { AddSubcontractorContractDialog } from "./add-subcontractor-contract-dialog";
import { PresupuestoTable } from "./presupuesto-table";
import { EjecucionTable } from "./ejecucion-table";
import { PersonalTable } from "./personal-table";
import { ProyectoComprasTable } from "./proyecto-compras-table";
import { SubcontratistasTable } from "./subcontratistas-table";
import { ProyectoFacturasTable } from "./proyecto-facturas-table";
import { ProyectoPagosTable } from "./proyecto-pagos-table";
import { ProyectoRfqsTable } from "./proyecto-rfqs-table";
import { ProyectoProveedoresTable } from "./proyecto-proveedores-table";
import { Invoice, PaymentOrder, Provider, Rfq } from "@/lib/types";

const BASE_TABS = [
  { key: "presupuesto", label: "Presupuesto" },
  { key: "cronograma", label: "Cronograma" },
  { key: "ejecucion", label: "Ejecución" },
  { key: "compras", label: "Compras" },
  { key: "cotizaciones", label: "Cotizaciones" },
  { key: "proveedores", label: "Proveedores" },
  { key: "facturas", label: "Facturas" },
  { key: "pagos", label: "Pagos" },
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
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
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

  // Cotizaciones y proveedores del proyecto: derivados de las OCs (authorized_orders).
  // Una OC tiene rfq_id y provider_id, ambos los heredamos para "modo carpeta".
  const orderIds = ocs.map((o) => o.id);
  let projectRfqs: Rfq[] = [];
  let projectProviders: Provider[] = [];
  if (orderIds.length > 0) {
    const rfqIds = [...new Set(ocs.map((o) => o.rfq_id).filter((id): id is string => !!id))];
    const providerIds = [...new Set(ocs.map((o) => o.provider_id).filter((id): id is string => !!id))];
    const [rfqFetch, providerFetch] = await Promise.all([
      rfqIds.length > 0
        ? supabase.from("rfqs").select("*").in("id", rfqIds).order("created_at", { ascending: false }).returns<Rfq[]>()
        : Promise.resolve({ data: [] as Rfq[] }),
      providerIds.length > 0
        ? supabase.from("providers").select("*").in("id", providerIds).order("name").returns<Provider[]>()
        : Promise.resolve({ data: [] as Provider[] }),
    ]);
    projectRfqs = rfqFetch.data ?? [];
    projectProviders = providerFetch.data ?? [];
  }

  // Facturas del proyecto: no tienen project_id propio, se derivan vía la OC
  // vinculada (invoice_order_matches). Una OC matchea a lo sumo una factura.
  let projectInvoices: Invoice[] = [];
  let projectPaymentOrders: PaymentOrder[] = [];
  let providerNameById = new Map<string, string>();
  if (orderIds.length > 0) {
    const { data: matches } = await supabase
      .from("invoice_order_matches")
      .select("invoice_id")
      .in("authorized_order_id", orderIds);
    const invoiceIds = (matches ?? []).map((m) => m.invoice_id as string);
    if (invoiceIds.length > 0) {
      const [{ data: invoiceRows }, { data: providerRows }] = await Promise.all([
        supabase.from("invoices").select("*").in("id", invoiceIds).order("invoice_date", { ascending: false }).returns<Invoice[]>(),
        supabase.from("providers").select("id, name").returns<Pick<Provider, "id" | "name">[]>(),
      ]);
      projectInvoices = invoiceRows ?? [];
      providerNameById = new Map((providerRows ?? []).map((p) => [p.id, p.name]));

      // Pagos: OPs que incluyan al menos una factura de este proyecto.
      const { data: poInvoices } = await supabase
        .from("payment_order_invoices")
        .select("payment_order_id")
        .in("invoice_id", invoiceIds);
      const paymentOrderIds = [...new Set((poInvoices ?? []).map((p) => p.payment_order_id as string))];
      if (paymentOrderIds.length > 0) {
        const { data: poRows } = await supabase
          .from("payment_orders")
          .select("*")
          .in("id", paymentOrderIds)
          .order("created_at", { ascending: false })
          .returns<PaymentOrder[]>();
        projectPaymentOrders = poRows ?? [];
      }
    }
  }
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
        <div className="flex items-center gap-1">
          <EditProjectDialog
            project={project}
            trigger={
              <Button variant="ghost" title="Editar obra">
                <Pencil size={15} />
              </Button>
            }
          />
          <DeleteProjectButton projectId={project.id} projectName={project.name} />
          <ProjectStatusSelect projectId={project.id} status={project.status} />
        </div>
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

      {tab === "presupuesto" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <AddBudgetItemForm projectId={project.id} />
            <ImportBudgetDialog projectId={project.id} />
            <DuplicateBudgetDialog targetProjectId={project.id} sources={duplicateSources} />
          </div>
          <PresupuestoTable
            rows={items.map((i) => {
              const exec = execByItem.get(i.id) ?? 0;
              const pct = i.quantity && i.quantity > 0 ? Math.min(100, Math.round((exec / i.quantity) * 100)) : null;
              return {
                id: i.id,
                code: i.code,
                description: i.description,
                unit: i.unit,
                quantity: i.quantity,
                unitPrice: i.unit_price,
                subtotal: i.subtotal,
                execPct: pct,
              };
            })}
            total={itemsSubtotal}
            projectId={project.id}
          />
        </div>
      ) : null}

      {tab === "cronograma" ? (
        <ProjectGantt projectId={project.id} budgetItems={items} execEntries={entries} />
      ) : null}

      {tab === "ejecucion" ? (
        <div className="space-y-3">
          <AddExecutionEntryForm projectId={project.id} budgetItems={items} />
          <EjecucionTable
            rows={entries.map((e) => {
              const item = items.find((i) => i.id === e.budget_item_id);
              const photoUrls = e.photo_paths.map((p) => photoUrlByPath.get(p)).filter((u): u is string => !!u);
              return {
                id: e.id,
                date: e.entry_date,
                itemLabel: item ? `${item.code} — ${item.description}` : "—",
                unit: item?.unit ?? "",
                quantityExecuted: e.quantity_executed,
                notes: e.notes,
                photoUrls,
              };
            })}
          />
        </div>
      ) : null}

      {tab === "compras" ? <ProyectoComprasTable rows={ocs} /> : null}

      {tab === "cotizaciones" ? <ProyectoRfqsTable rows={projectRfqs} /> : null}

      {tab === "proveedores" ? <ProyectoProveedoresTable rows={projectProviders} /> : null}

      {tab === "facturas" ? (
        <ProyectoFacturasTable rows={projectInvoices} providerNameById={providerNameById} />
      ) : null}

      {tab === "pagos" ? (
        <ProyectoPagosTable rows={projectPaymentOrders} providerNameById={providerNameById} />
      ) : null}

      {tab === "informes" ? (
        <ProjectReports project={project} budgetItems={items} execEntries={entries} orders={ocs} />
      ) : null}

      {tab === "personal" && isCaterpillar ? (
        <div className="space-y-3">
          <AddLaborEntryForm projectId={project.id} />
          <PersonalTable rows={laborRows} />
        </div>
      ) : null}

      {tab === "subcontratistas" && isCaterpillar ? (
        <div className="space-y-3">
          <AddSubcontractorContractDialog
            projectId={project.id}
            subcontractors={subcontractorCatalog}
            budgetItems={items}
          />
          <SubcontratistasTable
            appUrl={appUrl}
            rows={contracts.map((c) => {
              const sub = subcontractorCatalog.find((s) => s.id === c.subcontractor_id);
              const item = items.find((i) => i.id === c.budget_item_id);
              const summary = contractSummary(c.id);
              const usedPct = c.contracted_amount > 0
                ? Math.round(((summary.approvedAmount + summary.pendingAmount) / c.contracted_amount) * 100)
                : 0;
              return {
                contract: c,
                subName: sub?.name ?? "—",
                itemLabel: item ? `${item.code} — ${item.description}` : "—",
                approvedAmount: summary.approvedAmount,
                retentionAccum: summary.retentionAccum,
                usedPct,
                certs: certificates.filter((cert) => cert.contract_id === c.id),
              };
            })}
          />
        </div>
      ) : null}
    </div>
  );
}
