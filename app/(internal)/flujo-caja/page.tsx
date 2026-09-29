import { requireProfile } from "@/lib/auth";
import type { FlujoItem } from "@/lib/flujo-caja";
import { ocurrenciasGastoRecurrente, planSemanalToFlujoItems } from "@/lib/flujo-caja";
import { getWeeklyPlanDetailsAction } from "@/app/(internal)/projects/weekly-plan-actions";
import { createClient } from "@/lib/supabase/server";
import type {
  CuentaFinanciera,
  CurrencyCode,
  GastoRecurrente,
  Project,
} from "@/lib/types";

import { FlujoCajaSection } from "./flujo-caja-section";

// Facturas de compra que todavía representan una obligación de pago.
const INVOICE_PENDIENTES = ["PENDIENTE", "MATCH", "APROBADO_EXCEPCION", "APTO_PARA_PAGO"];

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async function FlujoCajaPage() {
  await requireProfile(["administracion", "admin"]);
  const supabase = await createClient();

  const ventanaFin = new Date();
  ventanaFin.setMonth(ventanaFin.getMonth() + 7);

  const [
    { data: cuentas },
    { data: gastos },
    { data: proyectos },
    { data: ventaDocs },
    { data: comprasInv },
    { data: certificados },
  ] = await Promise.all([
    supabase.from("cuentas_financieras").select("*").eq("activo", true).returns<CuentaFinanciera[]>(),
    supabase.from("gastos_recurrentes").select("*").order("descripcion").returns<GastoRecurrente[]>(),
    supabase
      .from("projects")
      .select("id, name, code, status, comitente")
      .in("status", ["ACTIVO", "PAUSADO"])
      .order("name")
      .returns<Pick<Project, "id" | "name" | "code" | "status" | "comitente">[]>(),
    supabase
      .from("sales_documents")
      .select("id, code, total, cobrado_amount, currency, due_date, issue_date, status, doc_type")
      .in("status", ["EMITIDA", "COBRADA_PARCIAL"])
      .in("doc_type", ["FACTURA", "NOTA_VENTA"]),
    supabase
      .from("invoices")
      .select("id, invoice_number, total, currency, due_date, invoice_date, status, provider_id")
      .in("status", INVOICE_PENDIENTES),
    supabase
      .from("project_certificates")
      .select("id, numero, project_id, monto_liquido, status, period_end, aprobado_at, facturado_at, sales_documents!certificate_id(id, status)")
      .in("status", ["APROBADO", "FACTURADO"]),
  ]);

  const saldoPorMoneda = new Map<CurrencyCode, number>();
  for (const c of cuentas ?? []) {
    saldoPorMoneda.set(c.moneda, (saldoPorMoneda.get(c.moneda) ?? 0) + c.saldo);
  }

  const items: FlujoItem[] = [];

  // Cobros de facturas de venta
  for (const d of ventaDocs ?? []) {
    const saldo = (d.total ?? 0) - (d.cobrado_amount ?? 0);
    if (saldo <= 0.01) continue;
    items.push({
      tipo: "cobro_factura",
      descripcion: `Cobro ${d.code}`,
      fecha: d.due_date ?? d.issue_date ?? null,
      monto: saldo,
      moneda: d.currency as CurrencyCode,
      project_id: null,
      ref_id: d.id as string,
    });
  }

  // Cobros de certificados de obra (estimado: fecha + 30 días)
  // Se excluyen los que ya tienen una factura de venta activa para evitar doble conteo.
  // (El cobro de esa factura ya aparece en el bucket cobro_factura arriba.)
  for (const c of certificados ?? []) {
    if (!c.monto_liquido || c.monto_liquido <= 0) continue;
    const hasActiveSalesDoc = (c as any).sales_documents?.some(
      (d: { id: string; status: string }) => d.status !== "ANULADA"
    );
    if (hasActiveSalesDoc) continue;
    const base = c.status === "FACTURADO" ? (c.facturado_at ?? c.period_end) : (c.aprobado_at ?? c.period_end);
    items.push({
      tipo: "cobro_certificado",
      descripcion: `Certificado N° ${c.numero}`,
      fecha: base ? addDays(String(base).slice(0, 10), 30) : null,
      monto: c.monto_liquido,
      moneda: "PYG",
      project_id: c.project_id as string,
      ref_id: c.id as string,
    });
  }

  // Pagos de facturas de compra pendientes
  for (const inv of comprasInv ?? []) {
    if (!inv.total || inv.total <= 0) continue;
    items.push({
      tipo: "pago_factura",
      descripcion: `Pago factura ${inv.invoice_number}`,
      fecha: inv.due_date ?? inv.invoice_date ?? null,
      monto: -inv.total,
      moneda: inv.currency as CurrencyCode,
      project_id: null,
      ref_id: inv.id as string,
    });
  }

  // Gastos recurrentes proyectados
  for (const g of (gastos ?? []).filter((x) => x.activo)) {
    const ocurrencias = ocurrenciasGastoRecurrente(
      g.monto_estimado,
      g.periodicidad,
      g.dia_del_mes,
      g.proximo_vencimiento,
      ventanaFin
    );
    for (const oc of ocurrencias) {
      items.push({
        tipo: "gasto_recurrente",
        descripcion: g.descripcion,
        fecha: oc.fecha,
        monto: -oc.monto,
        moneda: g.moneda,
        project_id: g.project_id,
        ref_id: `${g.id}-${oc.fecha}`,
      });
    }
  }

  // Lo que planifican las semanas por venir (borradores y comprometidos): faltante de
  // materiales y costo de mano de obra, equipos y subcontratos según las recetas.
  // Si algo falla se omite el plan afectado; el resto de la proyección no se toca.
  try {
    const hoy = new Date().toISOString().slice(0, 10);
    const { data: planes } = await supabase
      .from("project_weekly_plans")
      .select("id, project_id, status, start_date, end_date")
      .in("status", ["DRAFT", "COMMITTED"])
      .gte("end_date", hoy)
      .order("start_date", { ascending: true })
      .limit(12);
    const nombreObra = new Map((proyectos ?? []).map((p) => [p.id as string, (p.code ? p.code + " · " : "") + p.name]));
    const activos = (planes ?? []).filter((pl) => nombreObra.has(pl.project_id as string));
    const resultados = await Promise.allSettled(
      activos.map((pl) => getWeeklyPlanDetailsAction({ projectId: pl.project_id as string, planId: pl.id as string }))
    );
    resultados.forEach((r, i) => {
      if (r.status !== "fulfilled" || !r.value.data) return;
      const calc = r.value.data.calculation;
      const pl = activos[i];
      items.push(
        ...planSemanalToFlujoItems({
          planId: pl.id as string,
          projectId: pl.project_id as string,
          projectName: nombreObra.get(pl.project_id as string) ?? "Obra",
          status: pl.status as string,
          startDate: String(pl.start_date),
          endDate: String(pl.end_date),
          faltanteMateriales: calc.total_additional_cash_required,
          costoManoObra: calc.resource_requirements?.total_labor_cost ?? 0,
          costoEquipos: calc.resource_requirements?.total_equipment_cost ?? 0,
          costoSubcontratos: calc.resource_requirements?.total_subcontract_cost ?? 0,
        })
      );
    });
  } catch {
    // sin planes: el flujo sigue con lo demás
  }

  return (
    <FlujoCajaSection
      saldoPorMoneda={[...saldoPorMoneda.entries()]}
      items={items}
      gastos={gastos ?? []}
      cuentas={cuentas ?? []}
      proyectos={proyectos ?? []}
      hayCuentas={(cuentas ?? []).length > 0}
    />
  );
}
