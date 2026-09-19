import { describe, it, expect } from "vitest";
import {
  build30DayCashflowItems,
  calculate30DayNetCashflow,
  RawSalesDocForCashflow,
  RawCertificateForCashflow,
  RawInvoiceForCashflow,
  RawGastoRecurrenteForCashflow,
} from "../cashflow";

const todayIso = "2026-09-19";

describe("Cashflow 30 días", () => {
  it("cruza ventas, certificados, compras y gastos recurrentes en el horizonte de 30 días", () => {
    const ventaDocs: RawSalesDocForCashflow[] = [
      {
        id: "v1",
        code: "V-001",
        total: 100000000,
        cobrado_amount: 20000000, // saldo 80M
        currency: "PYG",
        due_date: "2026-09-25",
        issue_date: "2026-09-01",
      },
      // Venta fuera de la ventana de 30 días (noviembre)
      {
        id: "v2",
        code: "V-002",
        total: 50000000,
        cobrado_amount: 0,
        currency: "PYG",
        due_date: "2026-11-15",
        issue_date: "2026-09-01",
      },
    ];

    const certificados: RawCertificateForCashflow[] = [
      // Certificado de 50M con fecha estimada base (2026-09-01 + 30d = 2026-10-01, dentro de los 30d)
      {
        id: "c1",
        numero: "01",
        project_id: "p1",
        monto_liquido: 50000000,
        status: "APROBADO",
        aprobado_at: "2026-09-01",
        sales_documents: null,
      },
    ];

    const comprasInv: RawInvoiceForCashflow[] = [
      // Factura de compra a pagar de 30M en la ventana
      {
        id: "i1",
        invoice_number: "F-100",
        total: 30000000,
        currency: "PYG",
        due_date: "2026-09-29",
        invoice_date: "2026-09-10",
        status: "APTO_PARA_PAGO",
      },
    ];

    const gastos: RawGastoRecurrenteForCashflow[] = [
      // Gasto recurrente de alquiler: 10M que vence el 25
      {
        id: "g1",
        descripcion: "Alquiler oficina",
        monto_estimado: 10000000,
        periodicidad: "MENSUAL",
        dia_del_mes: 25,
        proximo_vencimiento: "2026-09-25",
        moneda: "PYG",
        activo: true,
        project_id: null,
      },
    ];

    const items = build30DayCashflowItems({
      todayIso,
      ventaDocs,
      certificados,
      comprasInv,
      gastos,
    });

    // Entradas: Cobro 80M + Certificado 50M = 130M
    // Salidas: Pago 30M + Gasto 10M = 40M
    // Neto = +90M
    const res = calculate30DayNetCashflow(items, "PYG");
    expect(res.entradas).toBe(130000000);
    expect(res.salidas).toBe(40000000);
    expect(res.neto).toBe(90000000);
    expect(res.formattedNeto).toContain("+90.000.000 PYG");
    expect(res.tone).toBe("ok");
  });

  it("asigna tono error si el flujo neto a 30 días es negativo", () => {
    const comprasInv: RawInvoiceForCashflow[] = [
      {
        id: "i1",
        invoice_number: "F-100",
        total: 100000000,
        currency: "PYG",
        due_date: "2026-09-25",
        invoice_date: "2026-09-10",
        status: "APTO_PARA_PAGO",
      },
    ];

    const items = build30DayCashflowItems({
      todayIso,
      ventaDocs: [],
      certificados: [],
      comprasInv,
      gastos: [],
    });

    const res = calculate30DayNetCashflow(items, "PYG");
    expect(res.neto).toBe(-100000000);
    expect(res.tone).toBe("error");
  });
});
