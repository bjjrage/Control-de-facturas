import { requireProfile, CurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Project, InvoiceStatus, SalesDocStatus } from "@/lib/types";
import { docSaldo } from "@/lib/sales";
import { formatMoney } from "@/lib/format";
import { classifyPayable, classifyReceivable } from "@/lib/dashboard-kpis";
import { PortfolioRow, PortfolioEstado } from "./portfolio-table";
import { DashboardIconKey } from "./icon-map";

const PLAN_RANK = { basico: 0, pro: 1, caterpillar: 2 } as const;

// Ventana de "próximo/por vencer" para todo el resumen ejecutivo (pagos,
// cobros, ofertas de licitación) — un solo lugar para no repetir el número
// mágico en cada cálculo y en el texto de los chips.
const DASHBOARD_UPCOMING_DAYS = 7;

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export type DomainTone = "ok" | "warn" | "error";

// Un KPI atómico — un número, un label, una sección (Administración u
// Obras/Licitaciones). Reemplaza el chip único "por dominio" que resumía 4
// métricas en una sola línea de texto: cada métrica indispensable de cada
// sección tiene su propio lugar, como en el diseño original.
export type MetricChip = {
  key: string;
  value: string;
  label: string;
  href: string;
  iconKey: DashboardIconKey;
  tone: DomainTone;
};

export type PanoramaObras = {
  obrasActivas: number;
  carteraActivaPyg: number;
  desviosCosto: number;
  desviosPlazo: number;
  avanceFisicoPonderado: number;
  estadoBreakdown: { normal: number; atencion: number; riesgo: number };
};

const PORTFOLIO_TABLE_LIMIT = 5;
const ESTADO_PRIORITY: Record<PortfolioEstado, number> = { Riesgo: 0, Atención: 1, Normal: 2 };

export type DashboardViewData = {
  firstName: string;
  canUseOperativo: boolean;
  adminKpis: MetricChip[];
  licitacionesKpis: MetricChip[];
  portfolioRows: PortfolioRow[];
  portfolioTotalCount: number;
  panorama: PanoramaObras | null;
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
  const en7dias = addDays(DASHBOARD_UPCOMING_DAYS);
  const en3diasAtras = addDays(-3);

  const isAdminOrAdministracion = p.role === "administracion" || p.role === "admin";
  const showInvoiceKpis = isAdminOrAdministracion && p.modulo_compras;
  const showSalesKpis = isAdminOrAdministracion && p.modulo_ventas;
  const canUseOperativo = PLAN_RANK[p.plan] >= PLAN_RANK.pro && isAdminOrAdministracion;
  const canUseLicitaciones = PLAN_RANK[p.plan] >= PLAN_RANK.pro && (p.role === "comercial" || isAdminOrAdministracion);

  const noopRows = Promise.resolve({ data: [] as unknown[] });
  const noopCount = Promise.resolve({ data: null, count: null } as { data: null; count: number | null });

  const [
    { data: payableInvoices },
    { data: receivableDocs },
    { data: projects },
    { count: ofertasPorVencer },
    { count: oportunidadesNuevas },
    { count: licitacionesEnCurso },
    { count: licitacionesGanadas },
  ] = await Promise.all([
    // CxP: nosotros debemos. Se trae todo lo no pagado con due_date — la
    // clasificación próxima/vencida la hace classifyPayable, no la query.
    showInvoiceKpis
      ? supabase.from("invoices").select("total, currency, due_date, status").neq("status", "PAGADO").not("due_date", "is", null)
      : noopRows,
    // CxC: nos deben. EMITIDA/COBRADA_PARCIAL son los únicos estados con
    // saldo potencialmente > 0; classifyReceivable vuelve a confirmarlo con
    // el saldo real (total - cobrado_amount), no solo con el status.
    showSalesKpis
      ? supabase
          .from("sales_documents")
          .select("total, cobrado_amount, currency, due_date, status")
          .in("status", ["EMITIDA", "COBRADA_PARCIAL"])
          .not("due_date", "is", null)
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
    // "En curso": todavía activamente en juego (preparando oferta o ya
    // presentada, esperando resultado) — ni descartada ni resuelta.
    canUseLicitaciones
      ? supabase
          .from("licitaciones")
          .select("id", { count: "exact", head: true })
          .in("decision", ["EN_PREPARACION", "PRESENTADA"])
      : noopCount,
    canUseLicitaciones
      ? supabase.from("licitaciones").select("id", { count: "exact", head: true }).eq("decision", "GANADA")
      : noopCount,
  ]);

  type PayableRow = { total: number; currency: string; due_date: string | null; status: InvoiceStatus };
  type ReceivableRow = { total: number; cobrado_amount: number; currency: string; due_date: string | null; status: SalesDocStatus };

  const payableRows = (payableInvoices ?? []) as PayableRow[];
  const pagosProximosRows = payableRows.filter((r) => classifyPayable(r, today, en7dias) === "proxima");
  const facturasVencidasPorPagarRows = payableRows.filter((r) => classifyPayable(r, today, en7dias) === "vencida");

  const receivableRows = (receivableDocs ?? []) as ReceivableRow[];
  const cobrosEsperadosRows = receivableRows.filter((r) => classifyReceivable(r, today, en7dias) === "esperado");
  const cobrosVencidosRows = receivableRows.filter((r) => classifyReceivable(r, today, en7dias) === "vencido");

  function sumPyg(rows: { total: number; currency: string }[]): number {
    return rows.filter((r) => r.currency === "PYG").reduce((s, r) => s + r.total, 0);
  }
  function sumPygSaldo(rows: { total: number; cobrado_amount: number; currency: string }[]): number {
    return rows.filter((r) => r.currency === "PYG").reduce((s, r) => s + docSaldo(r.total, r.cobrado_amount), 0);
  }

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

    return { id: pr.id, code: pr.code, name: pr.name, avancePct, comprasPct, atrasoDias, estado, presupuesto };
  });

  // ---------------------------------------------------------------------
  // KPIs de Administración — uno por métrica, monto real como valor
  // principal. Son los mismos 4 indicadores accionables de antes (cuánto
  // debo, cuánto vence, cuánto me deben, qué cobro se venció); antes
  // vivían aplanados en un solo chip de texto por Compras/Ventas.
  // ---------------------------------------------------------------------
  const adminKpis: MetricChip[] = [];
  if (showInvoiceKpis) {
    adminKpis.push({
      key: "pagos-proximos",
      value: formatMoney(sumPyg(pagosProximosRows)),
      label: `Pagos próximos · ${pagosProximosRows.length}`,
      href: "/pagos",
      iconKey: "calendar-clock",
      tone: pagosProximosRows.length > 0 ? "warn" : "ok",
    });
    adminKpis.push({
      key: "facturas-vencidas",
      value: formatMoney(sumPyg(facturasVencidasPorPagarRows)),
      label: `Facturas vencidas · ${facturasVencidasPorPagarRows.length}`,
      href: "/pagos",
      iconKey: "alert-octagon",
      tone: facturasVencidasPorPagarRows.length > 0 ? "error" : "ok",
    });
  }
  if (showSalesKpis) {
    adminKpis.push({
      key: "cobros-esperados",
      value: formatMoney(sumPygSaldo(cobrosEsperadosRows)),
      label: `Cobros esperados · ${cobrosEsperadosRows.length}`,
      href: "/cobros",
      iconKey: "wallet",
      tone: cobrosEsperadosRows.length > 0 ? "warn" : "ok",
    });
    adminKpis.push({
      key: "cobros-vencidos",
      value: formatMoney(sumPygSaldo(cobrosVencidosRows)),
      label: `Cobros vencidos · ${cobrosVencidosRows.length}`,
      href: "/cobros",
      iconKey: "file-x",
      tone: cobrosVencidosRows.length > 0 ? "error" : "ok",
    });
  }

  // KPIs de Licitaciones — 4, igual que Administración, para que la fila no
  // quede con 2 chips estirados a lo ancho (se veían "alargados al pedo").
  // Qué vence pronto, qué apareció nuevo, cuántas siguen en juego y cuántas
  // se ganaron — sin monto potencial ni win rate (eso no es indispensable
  // de un vistazo).
  const licitacionesKpis: MetricChip[] = canUseLicitaciones
    ? [
        {
          key: "ofertas-por-vencer",
          value: String(ofertasPorVencer ?? 0),
          label: "Ofertas próximas a vencer",
          href: "/licitaciones",
          iconKey: "calendar-clock",
          tone: (ofertasPorVencer ?? 0) > 0 ? "warn" : "ok",
        },
        {
          key: "oportunidades-nuevas",
          value: String(oportunidadesNuevas ?? 0),
          label: "Nuevas oportunidades (radar)",
          href: "/licitaciones",
          iconKey: "radar",
          tone: "ok",
        },
        {
          key: "licitaciones-en-curso",
          value: String(licitacionesEnCurso ?? 0),
          label: "En curso",
          href: "/licitaciones",
          iconKey: "gavel",
          tone: "ok",
        },
        {
          key: "licitaciones-ganadas",
          value: String(licitacionesGanadas ?? 0),
          label: "Ganadas",
          href: "/licitaciones",
          iconKey: "trophy",
          tone: "ok",
        },
      ]
    : [];

  // ---------------------------------------------------------------------
  // Panorama de obras: lo que antes era un textito chico ("7 activas · 26%
  // avance prom.") pasa a ser la mitad derecha del análisis de obra —
  // cartera activa en guaraníes, desvíos por tipo y avance ponderado por
  // presupuesto (una obra grande pesa más que una chica, no todas valen lo
  // mismo en el promedio).
  // ---------------------------------------------------------------------
  const panorama: PanoramaObras | null = canUseOperativo
    ? (() => {
        const carteraActivaPyg = portfolioRows.reduce((s, r) => s + r.presupuesto, 0);
        const pesoTotal = carteraActivaPyg;
        const avanceFisicoPonderado =
          pesoTotal > 0
            ? Math.round(portfolioRows.reduce((s, r) => s + r.avancePct * r.presupuesto, 0) / pesoTotal)
            : portfolioRows.length > 0
              ? Math.round(portfolioRows.reduce((s, r) => s + r.avancePct, 0) / portfolioRows.length)
              : 0;
        return {
          obrasActivas: portfolioRows.length,
          carteraActivaPyg,
          desviosCosto: portfolioRows.filter((r) => r.comprasPct !== null && r.comprasPct > 100).length,
          desviosPlazo: portfolioRows.filter((r) => r.atrasoDias !== null && r.atrasoDias > 0).length,
          avanceFisicoPonderado,
          estadoBreakdown: {
            normal: portfolioRows.filter((r) => r.estado === "Normal").length,
            atencion: portfolioRows.filter((r) => r.estado === "Atención").length,
            riesgo: portfolioRows.filter((r) => r.estado === "Riesgo").length,
          },
        };
      })()
    : null;

  // Tabla: vistazo rápido, no el listado completo — eso vive en /projects.
  // Se muestran como máximo 5, priorizando las que necesitan ojo (Riesgo
  // primero, luego Atención, luego Normal); el panorama de al lado sigue
  // calculado sobre TODA la cartera, no solo estas 5.
  const portfolioRowsTop = [...portfolioRows]
    .sort((a, b) => ESTADO_PRIORITY[a.estado] - ESTADO_PRIORITY[b.estado])
    .slice(0, PORTFOLIO_TABLE_LIMIT);

  return {
    firstName: p.full_name.split(" ")[0],
    canUseOperativo,
    adminKpis,
    licitacionesKpis,
    portfolioRows: portfolioRowsTop,
    portfolioTotalCount: portfolioRows.length,
    panorama,
  };
}
