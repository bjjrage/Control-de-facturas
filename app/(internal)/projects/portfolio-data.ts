import { readAll } from "@/lib/cashflow/load";
import { businessToday } from "@/lib/cashflow/dates";
import { requirePlan, type CurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Project } from "@/lib/types";
import {
  buildOperationalAttentionAlerts,
  buildPortfolioPanorama,
  buildPortfolioRows,
  countMaterialsBelowMinimum,
  sortPortfolioRows,
  type PortfolioPanorama,
  type PortfolioRow,
} from "@/lib/dashboard/portfolio";

export type ProjectListRow = {
  project: Project;
  presupuesto: number;
  compras: number;
  comprasPct: number | null;
  avancePct: number;
  atrasoDias: number | null;
  estado: PortfolioRow["estado"];
  enAlerta: boolean;
};

export type ProjectsPortfolioData = {
  projects: Project[];
  rows: ProjectListRow[];
  panorama: PortfolioPanorama;
  attentionAlerts: ReturnType<typeof buildOperationalAttentionAlerts>;
  chartData: { name: string; presupuesto: number; compras: number; avancePct: number }[];
  isCaterpillar: boolean;
};

type ProductMinimumRow = { id: string; stock_minimo: number };
type CanonicalStockRow = { producto_id: string; quantity: number };

function asProjectListRows(projects: Project[], rows: PortfolioRow[]): ProjectListRow[] {
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  return rows.map((row) => ({
    project: projectsById.get(row.id)!,
    presupuesto: row.presupuesto,
    compras: row.compras,
    comprasPct: row.comprasPct,
    avancePct: row.avancePct,
    atrasoDias: row.atrasoDias,
    estado: row.estado,
    enAlerta: row.estado !== "Normal",
  }));
}

export async function getProjectsPortfolioData(profile?: CurrentProfile): Promise<ProjectsPortfolioData> {
  const p = profile ?? (await requirePlan("pro", ["administracion", "admin"]));
  const supabase = await createClient();
  const complete=async(query:any,order="id")=>({data:await readAll<any>((from,to)=>query.order(order).range(from,to))});
  const { data: projectData } = await complete(supabase
    .from("projects")
    .select("*",{count:"exact"})
    .eq("empresa_id", p.empresa_id)
    .order("created_at", { ascending: false })
    .returns<Project[]>());

  const projects = projectData ?? [];
  const projectIds = projects.map((project) => project.id);
  const isCaterpillar = p.plan === "caterpillar" || p.is_super_admin;
  const emptyRows = Promise.resolve({ data: [] as unknown[] });

  const [{ data: budgetItems }, { data: orders }, { data: executionEntries }, { data: certificates }, { data: products }, stockResult, pendingResult] = await Promise.all([
    projectIds.length > 0
      ? complete(supabase.from("budget_items").select("id, project_id, quantity, subtotal",{count:"exact"}).in("project_id", projectIds))
      : emptyRows,
    projectIds.length > 0
      ? complete(supabase.from("authorized_orders").select("id, project_id, total_price, currency",{count:"exact"}).eq("empresa_id",p.empresa_id).in("project_id", projectIds).eq("currency", "PYG"))
      : emptyRows,
    projectIds.length > 0
      ? complete(supabase.from("execution_entries").select("id, project_id, budget_item_id, quantity_executed",{count:"exact"}).in("project_id", projectIds))
      : emptyRows,
    projectIds.length > 0
      ? complete(supabase.from("project_certificates").select("id, project_id, numero, monto_acumulado",{count:"exact"}).in("project_id", projectIds))
      : emptyRows,
    complete(supabase.from("productos").select("id, stock_minimo",{count:"exact"}).eq("empresa_id", p.empresa_id).eq("activo", true)),
    complete(supabase.from("inventory_stock_global_quantity").select("producto_id, quantity",{count:"exact"}).eq("empresa_id", p.empresa_id),"producto_id"),
    isCaterpillar && projectIds.length > 0
      ? supabase.from("subcontractor_certificates").select("id", { count: "exact", head: true }).in("project_id", projectIds).eq("status", "PENDIENTE")
      : Promise.resolve({ data: null, count: 0 }),
  ]);

  if("error" in pendingResult && pendingResult.error) throw new Error("Certificate source unavailable");
  const certificatesPending=pendingResult.count;
  const stockSourceUnavailable = false;
  const lowStockCount = stockSourceUnavailable ? 0 : countMaterialsBelowMinimum(
    (products as ProductMinimumRow[] | null) ?? [],
    (stockResult.data ?? []) as CanonicalStockRow[],
  );
  const authorizedOrders = (orders ?? []) as { project_id: string | null; total_price: number }[];
  const portfolioRows = buildPortfolioRows(
    projects,
    (budgetItems ?? []) as { id: string; project_id: string; quantity: number | null; subtotal: number }[],
    authorizedOrders,
    (executionEntries ?? []) as { project_id: string; budget_item_id: string | null; quantity_executed: number }[],
    businessToday(),
    (certificates ?? []) as { project_id: string; numero: number; monto_acumulado: number }[],
  );
  const sortedRows = sortPortfolioRows(portfolioRows);
  const activeProjectIds = new Set(projects.filter((project) => project.status === "ACTIVO").map((project) => project.id));
  const ordenesCompra = authorizedOrders.filter((order) => order.project_id && activeProjectIds.has(order.project_id)).length;

  return {
    projects,
    rows: asProjectListRows(projects, sortedRows),
    panorama: buildPortfolioPanorama(portfolioRows, lowStockCount, ordenesCompra, certificatesPending ?? 0, stockSourceUnavailable),
    attentionAlerts: buildOperationalAttentionAlerts(portfolioRows, lowStockCount, certificatesPending ?? 0, stockSourceUnavailable),
    chartData: portfolioRows
      .filter((row) => row.presupuesto > 0 || row.compras > 0)
      .map((row) => ({ name: row.code, presupuesto: row.presupuesto, compras: row.compras, avancePct: row.avancePct })),
    isCaterpillar,
  };
}
