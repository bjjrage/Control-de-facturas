import type { Project } from "@/lib/types";
import type { AttentionAlert } from "./types";

export type PortfolioEstado = "Normal" | "Atención" | "Riesgo";

export type PortfolioRow = {
  id: string;
  code: string;
  name: string;
  status: Project["status"];
  avancePct: number;
  compras: number;
  comprasPct: number | null;
  atrasoDias: number | null;
  estado: PortfolioEstado;
  presupuesto: number;
};

export type PortfolioPanorama = {
  obrasActivas: number;
  carteraActivaPyg: number;
  comprasRealizadasPyg: number;
  ordenesCompra: number;
  productosStockMinimo: number;
  certificadosPendientes: number;
  desviosCosto: number;
  desviosPlazo: number;
  avanceFisicoPonderado: number;
  estadoBreakdown: { normal: number; atencion: number; riesgo: number };
};

type BudgetItemSource = {
  project_id: string;
  quantity: number | null;
  subtotal: number;
};

type OrderSource = {
  project_id: string | null;
  total_price: number;
};

type ExecutionEntrySource = {
  project_id: string;
  quantity_executed: number;
};

const ESTADO_PRIORITY: Record<PortfolioEstado, number> = { Riesgo: 0, Atención: 1, Normal: 2 };

function projectRowState(atrasoDias: number | null, comprasPct: number | null): PortfolioEstado {
  if ((atrasoDias !== null && atrasoDias > 15) || (comprasPct !== null && comprasPct > 115)) return "Riesgo";
  if (atrasoDias !== null || (comprasPct !== null && comprasPct > 100)) return "Atención";
  return "Normal";
}

export function buildPortfolioRows(
  projects: Project[],
  budgetItems: BudgetItemSource[],
  orders: OrderSource[],
  executionEntries: ExecutionEntrySource[],
  todayIso: string,
): PortfolioRow[] {
  const subtotalByProject = new Map<string, number>();
  const budgetQtyByProject = new Map<string, number>();
  for (const item of budgetItems) {
    subtotalByProject.set(item.project_id, (subtotalByProject.get(item.project_id) ?? 0) + (item.subtotal ?? 0));
    if (item.quantity !== null) {
      budgetQtyByProject.set(item.project_id, (budgetQtyByProject.get(item.project_id) ?? 0) + item.quantity);
    }
  }

  const purchasesByProject = new Map<string, number>();
  for (const order of orders) {
    if (!order.project_id) continue;
    purchasesByProject.set(order.project_id, (purchasesByProject.get(order.project_id) ?? 0) + (order.total_price ?? 0));
  }

  const executedQtyByProject = new Map<string, number>();
  for (const entry of executionEntries) {
    executedQtyByProject.set(entry.project_id, (executedQtyByProject.get(entry.project_id) ?? 0) + (entry.quantity_executed ?? 0));
  }

  return projects.map((project) => {
    const presupuesto = Math.max(project.budget_total ?? 0, subtotalByProject.get(project.id) ?? 0);
    const compras = purchasesByProject.get(project.id) ?? 0;
    const budgetQty = budgetQtyByProject.get(project.id) ?? 0;
    const executedQty = executedQtyByProject.get(project.id) ?? 0;
    const avancePct = budgetQty > 0 ? Math.min(100, Math.round((executedQty / budgetQty) * 100)) : 0;
    const comprasPct = presupuesto > 0 && compras > 0 ? Math.round((compras / presupuesto) * 1000) / 10 : null;
    const atrasoBruto =
      project.end_date && avancePct < 100
        ? Math.round((Date.parse(todayIso) - Date.parse(project.end_date)) / 86_400_000)
        : null;
    const atrasoDias = atrasoBruto !== null && atrasoBruto > 0 ? atrasoBruto : null;

    return {
      id: project.id,
      code: project.code,
      name: project.name,
      status: project.status,
      avancePct,
      compras,
      comprasPct,
      atrasoDias,
      estado: projectRowState(atrasoDias, comprasPct),
      presupuesto,
    };
  });
}

export function buildPortfolioPanorama(
  rows: PortfolioRow[],
  productosStockMinimo: number,
  ordenesCompra = 0,
  certificadosPendientes = 0,
): PortfolioPanorama {
  const activeRows = rows.filter((row) => row.status === "ACTIVO");
  const carteraActivaPyg = activeRows.reduce((sum, row) => sum + row.presupuesto, 0);
  const comprasRealizadasPyg = activeRows.reduce((sum, row) => sum + row.compras, 0);
  const avanceFisicoPonderado =
    carteraActivaPyg > 0
      ? Math.round(activeRows.reduce((sum, row) => sum + row.avancePct * row.presupuesto, 0) / carteraActivaPyg)
      : activeRows.length > 0
        ? Math.round(activeRows.reduce((sum, row) => sum + row.avancePct, 0) / activeRows.length)
        : 0;

  return {
    obrasActivas: activeRows.length,
    carteraActivaPyg,
    comprasRealizadasPyg,
    ordenesCompra,
    productosStockMinimo,
    certificadosPendientes,
    desviosCosto: activeRows.filter((row) => row.comprasPct !== null && row.comprasPct > 100).length,
    desviosPlazo: activeRows.filter((row) => row.atrasoDias !== null).length,
    avanceFisicoPonderado,
    estadoBreakdown: {
      normal: activeRows.filter((row) => row.estado === "Normal").length,
      atencion: activeRows.filter((row) => row.estado === "Atención").length,
      riesgo: activeRows.filter((row) => row.estado === "Riesgo").length,
    },
  };
}

export function sortPortfolioRows(rows: PortfolioRow[]): PortfolioRow[] {
  return [...rows].sort((a, b) => ESTADO_PRIORITY[a.estado] - ESTADO_PRIORITY[b.estado]);
}

export function buildOperationalAttentionAlerts(
  rows: PortfolioRow[],
  productosStockMinimo: number,
  certificadosPendientes: number,
): AttentionAlert[] {
  const alerts: AttentionAlert[] = [];

  for (const row of rows.filter((item) => item.status === "ACTIVO" && item.atrasoDias !== null)) {
    alerts.push({
      id: `obra-atrasada-${row.id}`,
      label: `${row.name}: ${row.atrasoDias} días de atraso`,
      count: 1,
      href: `/projects/${row.id}`,
      tone: row.atrasoDias !== null && row.atrasoDias > 15 ? "error" : "warn",
      category: "obras",
    });
  }

  for (const row of rows.filter((item) => item.status === "ACTIVO" && item.comprasPct !== null && item.comprasPct > 100)) {
    alerts.push({
      id: `obra-costo-${row.id}`,
      label: `${row.name}: compras al ${row.comprasPct}% del presupuesto`,
      count: 1,
      href: `/projects/${row.id}`,
      tone: row.comprasPct !== null && row.comprasPct > 115 ? "error" : "warn",
      category: "obras",
    });
  }

  if (productosStockMinimo > 0) {
    alerts.push({
      id: "productos-stock-critico",
      label: `${productosStockMinimo} productos bajo stock mínimo`,
      count: productosStockMinimo,
      href: "/stock",
      tone: "warn",
      category: "stock",
    });
  }

  if (certificadosPendientes > 0) {
    alerts.push({
      id: "certificados-pendientes",
      label: `${certificadosPendientes} certificados pendientes`,
      count: certificadosPendientes,
      href: "/projects",
      tone: "warn",
      category: "obras",
    });
  }

  return alerts.slice(0, 8);
}
