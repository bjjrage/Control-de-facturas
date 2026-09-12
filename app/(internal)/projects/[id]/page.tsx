import { notFound } from "next/navigation";
import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  Project,
  BudgetItem,
  ExecutionEntry,
  AuthorizedOrder,
  Invoice,
  PaymentOrder,
  Provider,
  Rfq,
  DailyLaborEntry,
  Subcontractor,
  SubcontractorContract,
  SubcontractorCertificate,
  ProjectCertificate,
  ProjectCertificateItem,
  ProjectCertificateStaff,
  ProjectWeatherLog,
  ProjectSchedulePlan,
  ProjectSchedulePlanMonth,
  ProjectUnit,
  ProjectCertificateUnitProgress,
} from "@/lib/types";
import { ProjectTabsClient } from "./project-tabs-client";

const ALL_TABS = [
  "presupuesto",
  "cronograma",
  "ejecucion",
  "compras",
  "cotizaciones",
  "proveedores",
  "facturas",
  "pagos",
  "stock",
  "informes",
  "personal",
  "subcontratistas",
  "certificados",
  "avance-fisico",
  "bim",
];

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
  const initialTab = ALL_TABS.includes(rawTab ?? "") ? rawTab! : "presupuesto";
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .eq("empresa_id", empresaId)
    .single<Project>();
  if (!project) notFound();

  const [{ data: budgetItems }, { data: execEntries }, { data: orders }, { data: laborEntries }, { data: allProvidersData }] =
    await Promise.all([
      supabase
        .from("budget_items")
        .select("*")
        .eq("project_id", id)
        .order("sort_order")
        .returns<BudgetItem[]>(),
      supabase
        .from("execution_entries")
        .select("*")
        .eq("project_id", id)
        .order("entry_date", { ascending: false })
        .returns<ExecutionEntry[]>(),
      supabase
        .from("authorized_orders")
        .select("*")
        .eq("project_id", id)
        .order("authorized_at", { ascending: false })
        .returns<AuthorizedOrder[]>(),
      isCaterpillar
        ? supabase
            .from("daily_labor_entries")
            .select("*")
            .eq("project_id", id)
            .order("entry_date", { ascending: false })
            .returns<DailyLaborEntry[]>()
        : Promise.resolve({ data: [] as DailyLaborEntry[] }),
      supabase.from("providers").select("*").eq("active", true).order("name").returns<Provider[]>(),
    ]);
  const allProviders = allProvidersData ?? [];

  let projectCertificates: ProjectCertificate[] = [];
  const certificateItemsByCert: Record<string, ProjectCertificateItem[]> = {};
  const certificateStaffByCert: Record<string, ProjectCertificateStaff[]> = {};
  let projectUnits: ProjectUnit[] = [];
  const unitProgressByCert: Record<string, ProjectCertificateUnitProgress[]> = {};
  let projectWeatherLogs: ProjectWeatherLog[] = [];
  let projectSchedulePlans: ProjectSchedulePlan[] = [];
  const schedulePlanMonths: Record<string, ProjectSchedulePlanMonth[]> = {};
  if (isCaterpillar) {
    const [{ data: certRows }, { data: weatherRows }, { data: planRows }, { data: unitRows }] = await Promise.all([
      supabase
        .from("project_certificates")
        .select("*")
        .eq("project_id", id)
        .order("numero", { ascending: false })
        .returns<ProjectCertificate[]>(),
      supabase
        .from("project_weather_log")
        .select("*")
        .eq("project_id", id)
        .order("log_date")
        .returns<ProjectWeatherLog[]>(),
      supabase
        .from("project_schedule_plans")
        .select("*")
        .eq("project_id", id)
        .order("created_at")
        .returns<ProjectSchedulePlan[]>(),
      supabase
        .from("project_units")
        .select("*")
        .eq("project_id", id)
        .eq("activo", true)
        .order("sort_order")
        .returns<ProjectUnit[]>(),
    ]);
    projectCertificates = certRows ?? [];
    projectWeatherLogs = weatherRows ?? [];
    projectSchedulePlans = planRows ?? [];
    projectUnits = unitRows ?? [];

    if (projectCertificates.length > 0) {
      const certIds = projectCertificates.map((c) => c.id);
      const [{ data: itemRows }, { data: staffRows }, { data: progressRows }] = await Promise.all([
        supabase
          .from("project_certificate_items")
          .select("*")
          .in("certificate_id", certIds)
          .order("sort_order")
          .returns<ProjectCertificateItem[]>(),
        supabase
          .from("project_certificate_staff")
          .select("*")
          .in("certificate_id", certIds)
          .order("sort_order")
          .returns<ProjectCertificateStaff[]>(),
        supabase
          .from("project_certificate_unit_progress")
          .select("*")
          .in("certificate_id", certIds)
          .returns<ProjectCertificateUnitProgress[]>(),
      ]);
      for (const it of itemRows ?? []) (certificateItemsByCert[it.certificate_id] ??= []).push(it);
      for (const st of staffRows ?? []) (certificateStaffByCert[st.certificate_id] ??= []).push(st);
      for (const pr of progressRows ?? []) (unitProgressByCert[pr.certificate_id] ??= []).push(pr);
    }

    if (projectSchedulePlans.length > 0) {
      const { data: monthRows } = await supabase
        .from("project_schedule_plan_months")
        .select("*")
        .in(
          "plan_id",
          projectSchedulePlans.map((p) => p.id)
        )
        .order("month_index")
        .returns<ProjectSchedulePlanMonth[]>();
      for (const m of monthRows ?? []) (schedulePlanMonths[m.plan_id] ??= []).push(m);
    }
  }

  let subcontractorCatalog: Subcontractor[] = [];
  let contracts: SubcontractorContract[] = [];
  let certificates: SubcontractorCertificate[] = [];
  if (isCaterpillar) {
    const [{ data: subs }, { data: contractRows }] = await Promise.all([
      supabase
        .from("subcontractors")
        .select("*")
        .eq("empresa_id", empresaId)
        .order("name")
        .returns<Subcontractor[]>(),
      supabase
        .from("subcontractor_contracts")
        .select("*")
        .eq("project_id", id)
        .order("created_at", { ascending: false })
        .returns<SubcontractorContract[]>(),
    ]);
    subcontractorCatalog = subs ?? [];
    contracts = contractRows ?? [];
    if (contracts.length > 0) {
      const { data: certRows } = await supabase
        .from("subcontractor_certificates")
        .select("*")
        .in(
          "contract_id",
          contracts.map((c) => c.id)
        )
        .returns<SubcontractorCertificate[]>();
      certificates = certRows ?? [];
    }
  }

  // Consumo de materiales desde stock (SALIDA imputada a esta obra)
  const [{ data: consumoRows }, { data: stockProyectoRows }, { data: panolesRows }] = await Promise.all([
    supabase
      .from("stock_consumo_obra")
      .select("budget_item_id, producto_id, producto, unidad, cantidad, costo_total")
      .eq("project_id", id)
      .eq("empresa_id", empresaId),
    supabase
      .from("stock_por_proyecto")
      .select("producto_id, producto, unidad, costo_promedio, qty_comprada, qty_consumida, qty_disponible, costo_comprado, costo_consumido")
      .eq("project_id", id)
      .eq("empresa_id", empresaId),
    supabase
      .from("depositos")
      .select("id, nombre")
      .eq("project_id", id)
      .eq("empresa_id", empresaId)
      .eq("activo", true),
  ]);
  const consumo = (consumoRows ?? []) as {
    budget_item_id: string | null;
    producto_id: string;
    producto: string;
    unidad: string;
    cantidad: number;
    costo_total: number;
  }[];

  const items = budgetItems ?? [];
  const entries = execEntries ?? [];
  const ocs = orders ?? [];
  const laborRows = laborEntries ?? [];

  // Cotizaciones y proveedores: derivados de las OCs del proyecto
  const orderIds = ocs.map((o) => o.id);
  let projectRfqs: Rfq[] = [];
  let projectProviders: Provider[] = [];
  if (orderIds.length > 0) {
    const rfqIds = [...new Set(ocs.map((o) => o.rfq_id).filter((rid): rid is string => !!rid))];
    const providerIds = [
      ...new Set(ocs.map((o) => o.provider_id).filter((pid): pid is string => !!pid)),
    ];
    const [rfqFetch, providerFetch] = await Promise.all([
      rfqIds.length > 0
        ? supabase
            .from("rfqs")
            .select("*")
            .in("id", rfqIds)
            .order("created_at", { ascending: false })
            .returns<Rfq[]>()
        : Promise.resolve({ data: [] as Rfq[] }),
      providerIds.length > 0
        ? supabase.from("providers").select("*").in("id", providerIds).order("name").returns<Provider[]>()
        : Promise.resolve({ data: [] as Provider[] }),
    ]);
    projectRfqs = rfqFetch.data ?? [];
    projectProviders = providerFetch.data ?? [];
  }

  // Proveedores agregados a mano a la obra (shortlist, sin OC todavía) — se
  // suman a los derivados de OCs de arriba. `manualProviderIds` sirve para
  // saber cuáles se pueden sacar de la obra (los que ya tienen una OC se
  // quedan sí o sí, la fila representa una compra real).
  const { data: linkedProviderRows } = await supabase
    .from("project_providers")
    .select("provider_id, providers(*)")
    .eq("project_id", id);
  const manualProviderIds = new Set((linkedProviderRows ?? []).map((r) => r.provider_id as string));
  const ocProviderIds = new Set(projectProviders.map((p) => p.id));
  const manualOnlyProviders = (linkedProviderRows ?? [])
    .map((r) => r.providers as unknown as Provider)
    .filter((p): p is Provider => !!p && !ocProviderIds.has(p.id));
  projectProviders = [...projectProviders, ...manualOnlyProviders].sort((a, b) =>
    a.name.localeCompare(b.name, "es")
  );
  const removableProviderIds = [...manualProviderIds].filter((pid) => !ocProviderIds.has(pid));

  // Facturas y pagos: derivados via invoice_order_matches
  let projectInvoices: Invoice[] = [];
  let projectPaymentOrders: PaymentOrder[] = [];
  let providerNameById: Record<string, string> = {};
  if (orderIds.length > 0) {
    const { data: matches } = await supabase
      .from("invoice_order_matches")
      .select("invoice_id")
      .in("authorized_order_id", orderIds);
    const invoiceIds = (matches ?? []).map((m) => m.invoice_id as string);
    if (invoiceIds.length > 0) {
      const [{ data: invoiceRows }, { data: providerRows }] = await Promise.all([
        supabase
          .from("invoices")
          .select("*")
          .in("id", invoiceIds)
          .order("invoice_date", { ascending: false })
          .returns<Invoice[]>(),
        supabase.from("providers").select("id, name").returns<Pick<Provider, "id" | "name">[]>(),
      ]);
      projectInvoices = invoiceRows ?? [];
      providerNameById = Object.fromEntries((providerRows ?? []).map((p) => [p.id, p.name]));

      const { data: poInvoices } = await supabase
        .from("payment_order_invoices")
        .select("payment_order_id")
        .in("invoice_id", invoiceIds);
      const paymentOrderIds = [
        ...new Set((poInvoices ?? []).map((p) => p.payment_order_id as string)),
      ];
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

  const laborHoursTotal = laborRows.reduce((s, l) => s + l.hours, 0);
  const laborCostTotal = laborRows.reduce((s, l) => s + l.labor_cost, 0);
  const itemsSubtotal = items.reduce((s, i) => s + i.subtotal, 0);
  const presupuestoTotal = Math.max(project.budget_total, itemsSubtotal);
  const comprasTotal = ocs
    .filter((o) => o.currency === "PYG")
    .reduce((s, o) => s + o.total_price, 0);
  const comprasPct =
    presupuestoTotal > 0 ? Math.round((comprasTotal / presupuestoTotal) * 100) : 0;

  // Fotos: URLs firmadas (solo disponibles server-side)
  const allPhotoPaths = entries.flatMap((e) => e.photo_paths);
  let photoUrlByPath: Record<string, string> = {};
  if (allPhotoPaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from("execution-photos")
      .createSignedUrls(allPhotoPaths, 3600);
    photoUrlByPath = Object.fromEntries(
      (signed ?? []).filter((s) => s.signedUrl).map((s) => [s.path ?? "", s.signedUrl!])
    );
  }

  // Metadata de verificación de cada foto (cámara/archivo, GPS, timestamp)
  let photoMetaByPath: Record<
    string,
    { source: string; captured_at: string | null; server_received_at: string; lat: number | null; lng: number | null; gps_accuracy_m: number | null }
  > = {};
  if (entries.length > 0) {
    const { data: photoMeta } = await supabase
      .from("execution_entry_photos")
      .select("storage_path, source, captured_at, server_received_at, lat, lng, gps_accuracy_m")
      .eq("project_id", id);
    photoMetaByPath = Object.fromEntries(
      (photoMeta ?? []).map((m) => [
        m.storage_path as string,
        {
          source: m.source as string,
          captured_at: m.captured_at as string | null,
          server_received_at: m.server_received_at as string,
          lat: m.lat as number | null,
          lng: m.lng as number | null,
          gps_accuracy_m: m.gps_accuracy_m as number | null,
        },
      ])
    );
  }

  // Proyectos candidatos para "Copiar de otro proyecto"
  let duplicateSources: { id: string; code: string; name: string; itemCount: number }[] = [];
  if (items.length === 0) {
    const { data: otherProjects } = await supabase
      .from("projects")
      .select("id, code, name")
      .eq("empresa_id", empresaId)
      .neq("id", id)
      .returns<Pick<Project, "id" | "code" | "name">[]>();
    const otherIds = (otherProjects ?? []).map((p) => p.id);
    const { data: otherItems } =
      otherIds.length > 0
        ? await supabase.from("budget_items").select("project_id").in("project_id", otherIds)
        : { data: [] };
    const countByProject = new Map<string, number>();
    for (const b of otherItems ?? []) {
      countByProject.set(
        b.project_id as string,
        (countByProject.get(b.project_id as string) ?? 0) + 1
      );
    }
    duplicateSources = (otherProjects ?? [])
      .map((p) => ({ ...p, itemCount: countByProject.get(p.id) ?? 0 }))
      .filter((p) => p.itemCount > 0);
  }

  return (
    <ProjectTabsClient
      project={project}
      initialTab={initialTab}
      isCaterpillar={isCaterpillar}
      appUrl={appUrl}
      items={items}
      entries={entries}
      photoUrlByPath={photoUrlByPath}
      photoMetaByPath={photoMetaByPath}
      ocs={ocs}
      allProviders={allProviders}
      projectRfqs={projectRfqs}
      projectProviders={projectProviders}
      removableProviderIds={removableProviderIds}
      projectInvoices={projectInvoices}
      projectPaymentOrders={projectPaymentOrders}
      providerNameById={providerNameById}
      laborRows={laborRows}
      laborHoursTotal={laborHoursTotal}
      laborCostTotal={laborCostTotal}
      subcontractorCatalog={subcontractorCatalog}
      contracts={contracts}
      certificates={certificates}
      projectCertificates={projectCertificates}
      certificateItemsByCert={certificateItemsByCert}
      certificateStaffByCert={certificateStaffByCert}
      projectUnits={projectUnits}
      unitProgressByCert={unitProgressByCert}
      projectWeatherLogs={projectWeatherLogs}
      projectSchedulePlans={projectSchedulePlans}
      schedulePlanMonths={schedulePlanMonths}
      consumo={consumo}
      stockProyecto={(stockProyectoRows ?? []) as import("./proyecto-stock-section").StockProyectoRow[]}
      panoles={(panolesRows ?? []) as { id: string; nombre: string }[]}
      isAdmin={profile.role === "admin"}
      duplicateSources={duplicateSources}
      itemsSubtotal={itemsSubtotal}
      presupuestoTotal={presupuestoTotal}
      comprasTotal={comprasTotal}
      comprasPct={comprasPct}
    />
  );
}
