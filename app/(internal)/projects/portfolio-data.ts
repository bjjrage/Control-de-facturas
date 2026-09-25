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
  const { data: projectData } = await supabase
    .from("projects")
    .select("*")
    .eq("empresa_id", p.empresa_id)
    .order("created_at", { ascending: false })
    .returns<Project[]>();

  const projects = projectData ?? [];
  const projectIds = projects.map((project) => project.id);
  const isCaterpillar = p.plan === "caterpillar";
  const emptyRows = Promise.resolve({ data: [] as unknown[] });

  const [{ data: budgetItems }, { data: orders }, { data: executionEntries }, { data: products }, stockResult, { count: certificatesPending }] = await Promise.all([
    projectIds.length > 0
      ? supabase.from("budget_items").select("project_id, quantity, subtotal").in("project_id", projectIds)
      : emptyRows,
    projectIds.length > 0
      ? supabase.from("authorized_orders").select("project_id, total_price, currency").in("project_id", projectIds).eq("currency", "PYG")
      : emptyRows,
    projectIds.length > 0
      ? supabase.from("execution_entries").select("project_id, quantity_executed").in("project_id", projectIds)
      : emptyRows,
    supabase.from("productos").select("id, stock_minimo").eq("empresa_id", p.empresa_id).eq("activo", true),
    supabase.from("inventory_stock_global_quantity").select("producto_id, quantity").eq("empresa_id", p.empresa_id),
    isCaterpillar && projectIds.length > 0
      ? supabase.from("subcontractor_certificates").select("id", { count: "exact", head: true }).in("project_id", projectIds).eq("status", "PENDIENTE")
      : Promise.resolve({ data: null, count: 0 }),
  ]);

  const stockSourceUnavailable = !!stockResult.error;
  const lowStockCount = stockSourceUnavailable ? 0 : countMaterialsBelowMinimum(
    (products as ProductMinimumRow[] | null) ?? [],
    (stockResult.data ?? []) as CanonicalStockRow[],
  );
  const authorizedOrders = (orders ?? []) as { project_id: string | null; total_price: number }[];
  const portfolioRows = buildPortfolioRows(
    projects,
    (budgetItems ?? []) as { project_id: string; quantity: number | null; subtotal: number }[],
    authorizedOrders,
    (executionEntries ?? []) as { project_id: string; quantity_executed: number }[],
    new Date().toISOString().slice(0, 10),
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
