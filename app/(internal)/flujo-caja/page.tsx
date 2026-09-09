import { requireProfile } from "@/lib/auth";
import type { FlujoItem } from "@/lib/flujo-caja";
import { ocurrenciasGastoRecurrente } from "@/lib/flujo-caja";
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
      .select("id, numero, project_id, monto_liquido, status, period_end, aprobado_at, facturado_at")
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
  for (const c of certificados ?? []) {
    if (!c.monto_liquido || c.monto_liquido <= 0) continue;
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
