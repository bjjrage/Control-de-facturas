import { requireProfile, CurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Project } from "@/lib/types";
import { PortfolioRow, PortfolioEstado } from "./portfolio-table";
import { AdminKpi } from "./admin-kpis";
import { LicitacionKpi } from "./licitaciones-kpis";
import { AttentionItem } from "./attention-section";

const PLAN_RANK = { basico: 0, pro: 1, caterpillar: 2 } as const;

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export type DashboardViewData = {
  firstName: string;
  canUseOperativo: boolean;
  portfolioRows: PortfolioRow[];
  avanceProm: number;
  obrasEnRiesgo: number;
  adminKpis: AdminKpi[];
  licitacionesKpis: LicitacionKpi[];
  attentionItems: AttentionItem[];
};

/**
 * Toda la data del resumen ejecutivo, compartida entre el render server
 * (page.tsx, primera carga) y el render client del shell de navegación
 * instantánea (section-action.ts + dashboard-section.tsx). Devuelve solo
 * datos serializables — el mapeo a íconos de React vive en icon-map.ts, del
 * lado de la presentación, para que este módulo sirva a ambos casos.
 */
export async function getDashboardViewData(profile?: CurrentProfile): Promise<DashboardViewData> {
  const p = profile ?? (await requireProfile());
  const supabase = await createClient();
  const empresaId = p.empresa_id;
  const today = addDays(0);
  const en7dias = addDays(7);
  const en3diasAtras = addDays(-3);

  const isAdminOrAdministracion = p.role === "administracion" || p.role === "admin";
  const showInvoiceKpis = isAdminOrAdministracion && p.modulo_compras;
  const showSalesKpis = isAdminOrAdministracion && p.modulo_ventas;
  const canUseOperativo = PLAN_RANK[p.plan] >= PLAN_RANK.pro && isAdminOrAdministracion;
  const canUseLicitaciones = PLAN_RANK[p.plan] >= PLAN_RANK.pro && (p.role === "comercial" || isAdminOrAdministracion);

  const noopRows = Promise.resolve({ data: [] as unknown[] });
  const noopCount = Promise.resolve({ data: null, count: null } as { data: null; count: number | null });

  const [
    { data: pagosProximos },
    { data: pagosVencidos },
    { data: facturasVentaVencidas },
    { data: cobrosEsperados },
    { data: projects },
    { count: ofertasPorVencer },
    { count: oportunidadesNuevas },
  ] = await Promise.all([
    showInvoiceKpis
      ? supabase
          .from("invoices")
          .select("total, currency")
          .eq("status", "APTO_PARA_PAGO")
          .gte("due_date", today)
          .lte("due_date", en7dias)
      : noopRows,
    showInvoiceKpis
      ? supabase.from("invoices").select("total, currency").eq("status", "APTO_PARA_PAGO").lt("due_date", today)
      : noopRows,
    showSalesKpis
      ? supabase
          .from("sales_documents")
          .select("total, cobrado_amount, currency")
          .in("status", ["EMITIDA", "COBRADA_PARCIAL"])
          .lt("due_date", today)
      : noopRows,
    showSalesKpis
      ? supabase
          .from("sales_documents")
          .select("total, cobrado_amount, currency, due_date")
          .in("status", ["EMITIDA", "COBRADA_PARCIAL"])
      : noopRows,
    canUseOperativo
      ? supabase
          .from("projects")
          .select("*")
          .eq("empresa_id", empresaId)
          .eq("status", "ACTIVO")
          .order("created_at", { ascending: false })
          .returns<Project[]>()
      : noopRows,
    canUseLicitaciones
      ? supabase
          .from("licitaciones")
          .select("id", { count: "exact", head: true })
          .eq("decision", "EN_PREPARACION")
          .gte("fecha_entrega_ofertas", today)
          .lte("fecha_entrega_ofertas", en7dias)
      : noopCount,
    canUseLicitaciones
      ? supabase
          .from("licitaciones")
          .select("id", { count: "exact", head: true })
          .eq("decision", "SIN_REVISAR")
          .gte("synced_at", en3diasAtras)
      : noopCount,
  ]);

  function sumPyg(rows: { total: number; currency: string }[]): number {
    return rows.filter((r) => r.currency === "PYG").reduce((s, r) => s + r.total, 0);
  }
  function sumPygSaldo(rows: { total: number; cobrado_amount: number; currency: string }[]): number {
    return rows.filter((r) => r.currency === "PYG").reduce((s, r) => s + (r.total - r.cobrado_amount), 0);
  }

  const cobrosEsperadosRows = (cobrosEsperados ?? []) as { total: number; cobrado_amount: number; currency: string; due_date: string | null }[];
  const cobrosEsperadosNoVencidos = cobrosEsperadosRows.filter((r) => !r.due_date || r.due_date >= today);

  const adminKpis: AdminKpi[] = [];
  const pagosVencidosRows = (pagosVencidos ?? []) as { total: number; currency: string }[];
  const facturasVencidasRows = (facturasVentaVencidas ?? []) as { total: number; cobrado_amount: number; currency: string }[];
  if (showInvoiceKpis) {
    const rows = (pagosProximos ?? []) as { total: number; currency: string }[];
    adminKpis.push({
      key: "pagos-proximos",
      label: "Pagos próximos",
      amountPyg: sumPyg(rows),
      count: rows.length,
      href: "/pagos",
      iconKey: "calendar-clock",
      tone: "neutral",
    });
    adminKpis.push({
      key: "pagos-vencidos",
      label: "Pagos vencidos",
      amountPyg: sumPyg(pagosVencidosRows),
      count: pagosVencidosRows.length,
      href: "/pagos",
      iconKey: "alert-octagon",
      tone: pagosVencidosRows.length > 0 ? "error" : "ok",
    });
  }
  if (showSalesKpis) {
    adminKpis.push({
      key: "facturas-vencidas",
      label: "Facturas vencidas",
      amountPyg: sumPygSaldo(facturasVencidasRows),
      count: facturasVencidasRows.length,
      href: "/cobros",
      iconKey: "file-x",
      tone: facturasVencidasRows.length > 0 ? "error" : "ok",
    });
    adminKpis.push({
      key: "cobros-esperados",
      label: "Cobros esperados",
      amountPyg: sumPygSaldo(cobrosEsperadosNoVencidos),
      count: cobrosEsperadosNoVencidos.length,
      href: "/cobros",
      iconKey: "wallet",
      tone: "neutral",
    });
  }

  const licitacionesKpis: LicitacionKpi[] = canUseLicitaciones
    ? [
        {
          key: "ofertas-por-vencer",
          label: "Ofertas próximas a vencer",
          count: ofertasPorVencer ?? 0,
          href: "/licitaciones",
          iconKey: "calendar-clock",
          tone: (ofertasPorVencer ?? 0) > 0 ? "warn" : "primary",
        },
        {
          key: "oportunidades-nuevas",
          label: "Nuevas oportunidades (radar)",
          count: oportunidadesNuevas ?? 0,
          href: "/licitaciones",
          iconKey: "radar",
          tone: "primary",
        },
      ]
    : [];

  // Portafolio: mismo cálculo de avance/compras que /projects, restringido a
  // obras activas y con menos columnas — pensado para lectura rápida, no
  // para gestión (eso sigue viviendo en /projects).
  const projectList = (projects ?? []) as Project[];
  const projectIds = projectList.map((pr) => pr.id);
  const [{ data: budgetItems }, { data: orders }, { data: execEntries }] = await Promise.all([
    projectIds.length > 0
      ? supabase.from("budget_items").select("project_id, quantity, subtotal").in("project_id", projectIds)
      : noopRows,
    projectIds.length > 0
      ? supabase
          .from("authorized_orders")
          .select("project_id, total_price, currency")
          .in("project_id", projectIds)
          .eq("currency", "PYG")
      : noopRows,
    projectIds.length > 0
      ? supabase.from("execution_entries").select("project_id, quantity_executed").in("project_id", projectIds)
      : noopRows,
  ]);

  const subtotalByProject = new Map<string, number>();
  const budgetQtyByProject = new Map<string, number>();
  for (const b of (budgetItems ?? []) as { project_id: string; quantity: number | null; subtotal: number }[]) {
    subtotalByProject.set(b.project_id, (subtotalByProject.get(b.project_id) ?? 0) + b.subtotal);
    if (b.quantity != null) budgetQtyByProject.set(b.project_id, (budgetQtyByProject.get(b.project_id) ?? 0) + b.quantity);
  }
  const comprasByProject = new Map<string, number>();
  for (const o of (orders ?? []) as { project_id: string | null; total_price: number }[]) {
    if (!o.project_id) continue;
    comprasByProject.set(o.project_id, (comprasByProject.get(o.project_id) ?? 0) + o.total_price);
  }
  const execQtyByProject = new Map<string, number>();
  for (const e of (execEntries ?? []) as { project_id: string; quantity_executed: number }[]) {
    execQtyByProject.set(e.project_id, (execQtyByProject.get(e.project_id) ?? 0) + e.quantity_executed);
  }

  const portfolioRows: PortfolioRow[] = projectList.map((pr) => {
    const presupuesto = Math.max(pr.budget_total, subtotalByProject.get(pr.id) ?? 0);
    const compras = comprasByProject.get(pr.id) ?? 0;
    const budgetQty = budgetQtyByProject.get(pr.id) ?? 0;
    const execQty = execQtyByProject.get(pr.id) ?? 0;
    const avancePct = budgetQty > 0 ? Math.min(100, Math.round((execQty / budgetQty) * 100)) : 0;
    // Sin compras registradas todavía no hay nada que desviarse — mostrar
    // "-100%" ahí sería ruido, no señal (la obra recién está arrancando).
    const comprasPct = presupuesto > 0 && compras > 0 ? Math.round((compras / presupuesto) * 1000) / 10 : null;
    const atrasoBruto =
      pr.end_date && avancePct < 100
        ? Math.round((Date.parse(today) - Date.parse(pr.end_date)) / 86400000)
        : null;
    const atrasoDias = atrasoBruto && atrasoBruto > 0 ? atrasoBruto : null;

    let estado: PortfolioEstado = "Normal";
    if ((atrasoDias && atrasoDias > 15) || (comprasPct !== null && comprasPct > 115)) estado = "Riesgo";
    else if (atrasoDias || (comprasPct !== null && comprasPct > 100)) estado = "Atención";

    return { id: pr.id, code: pr.code, name: pr.name, avancePct, comprasPct, atrasoDias, estado };
  });

  const obrasEnRiesgo = portfolioRows.filter((r) => r.estado !== "Normal").length;
  const avanceProm =
    portfolioRows.length > 0 ? Math.round(portfolioRows.reduce((s, r) => s + r.avancePct, 0) / portfolioRows.length) : 0;

  const attentionItems: AttentionItem[] = [];
  for (const r of portfolioRows) {
    if (r.estado === "Riesgo") {
      attentionItems.push({
        key: `obra-${r.id}`,
        text: `${r.name}: ${r.atrasoDias ? `${r.atrasoDias} días de atraso` : "desvío de costo relevante"}`,
        href: `/projects/${r.id}`,
        iconKey: "hardhat",
        severity: "error",
      });
    } else if (r.estado === "Atención") {
      attentionItems.push({
        key: `obra-${r.id}`,
        text: `${r.name}: requiere seguimiento`,
        href: `/projects/${r.id}`,
        iconKey: "hardhat",
        severity: "warn",
      });
    }
  }
  if (showInvoiceKpis && pagosVencidosRows.length > 0) {
    attentionItems.push({
      key: "pagos-vencidos",
      text: `${pagosVencidosRows.length} pago${pagosVencidosRows.length !== 1 ? "s" : ""} vencido${pagosVencidosRows.length !== 1 ? "s" : ""}`,
      href: "/pagos",
      iconKey: "wallet",
      severity: "error",
    });
  }
  if (showSalesKpis && facturasVencidasRows.length > 0) {
    attentionItems.push({
      key: "facturas-vencidas",
      text: `${facturasVencidasRows.length} factura${facturasVencidasRows.length !== 1 ? "s" : ""} de venta vencida${facturasVencidasRows.length !== 1 ? "s" : ""}`,
      href: "/cobros",
      iconKey: "file-x",
      severity: "error",
    });
  }
  if (canUseLicitaciones && (ofertasPorVencer ?? 0) > 0) {
    attentionItems.push({
      key: "licitaciones-vencen",
      text: `${ofertasPorVencer} oferta${ofertasPorVencer !== 1 ? "s" : ""} vence${ofertasPorVencer !== 1 ? "n" : ""} en los próximos 7 días`,
      href: "/licitaciones",
      iconKey: "gavel",
      severity: "warn",
    });
  }

  return {
    firstName: p.full_name.split(" ")[0],
    canUseOperativo,
    portfolioRows,
    avanceProm,
    obrasEnRiesgo,
    adminKpis,
    licitacionesKpis,
    attentionItems,
  };
}
