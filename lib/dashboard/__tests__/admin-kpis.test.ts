import { describe, it, expect } from "vitest";
import { computeAdminKpis, computeAdminSecondaryKpis, RawSalesDocForKpi, RawReceiptForKpi, RawInvoiceForKpi, RawCuentaFinancieraForKpi, RawOrderForKpi } from "../admin-kpis";

const todayIso = "2026-09-19";

describe("computeAdminKpis", () => {
  it("computa facturación del mes excluyendo borradores y anuladas, solo FACTURA", () => {
    const salesDocs: RawSalesDocForKpi[] = [
      {
        id: "1",
        doc_type: "FACTURA",
        status: "EMITIDA",
        total: 100000000,
        cobrado_amount: 0,
        currency: "PYG",
        issue_date: "2026-09-05",
        due_date: "2026-10-05",
      },
      {
        id: "2",
        doc_type: "FACTURA",
        status: "COBRADA",
        total: 50000000,
        cobrado_amount: 50000000,
        currency: "PYG",
        issue_date: "2026-09-10",
        due_date: "2026-09-25",
      },
      // Borrador: no debe sumar
      {
        id: "3",
        doc_type: "FACTURA",
        status: "BORRADOR",
        total: 30000000,
        cobrado_amount: 0,
        currency: "PYG",
        issue_date: "2026-09-12",
        due_date: null,
      },
      // Anulada: no debe sumar
      {
        id: "4",
        doc_type: "FACTURA",
        status: "ANULADA",
        total: 40000000,
        cobrado_amount: 0,
        currency: "PYG",
        issue_date: "2026-09-14",
        due_date: null,
      },
      // Nota de venta (no factura): no cuenta para KPI facturación
      {
        id: "5",
        doc_type: "NOTA_VENTA",
        status: "EMITIDA",
        total: 20000000,
        cobrado_amount: 0,
        currency: "PYG",
        issue_date: "2026-09-15",
        due_date: null,
      },
    ];

    const kpis = computeAdminKpis({
      todayIso,
      salesDocs,
      receipts: [],
      invoices: [],
      cuentas: [],
      orders: [],
      cashflowItems: [],
      showSalesKpis: true,
      showInvoiceKpis: true,
    });

    const facturacionMes = kpis.find((k) => k.key === "facturacion-mes");
    expect(facturacionMes).toBeDefined();
    // 100M + 50M = 150M PYG
    expect(facturacionMes?.value).toContain("150.000.000");
    expect(facturacionMes?.secondaryText).toBe("2 facturas");
  });

  it("calcula comparación porcentual con mes anterior si hay datos", () => {
    const salesDocs: RawSalesDocForKpi[] = [
      // Mes actual: 200M
      {
        id: "1",
        doc_type: "FACTURA",
        status: "EMITIDA",
        total: 200000000,
        cobrado_amount: 0,
        currency: "PYG",
        issue_date: "2026-09-01",
        due_date: null,
      },
      // Mes anterior (agosto): 100M (+100% de aumento)
      {
        id: "2",
        doc_type: "FACTURA",
        status: "COBRADA",
        total: 100000000,
        cobrado_amount: 100000000,
        currency: "PYG",
        issue_date: "2026-08-15",
        due_date: null,
      },
    ];

    const kpis = computeAdminKpis({
      todayIso,
      salesDocs,
      receipts: [],
      invoices: [],
      cuentas: [],
      orders: [],
      cashflowItems: [],
      showSalesKpis: true,
      showInvoiceKpis: true,
    });

    const facturacionMes = kpis.find((k) => k.key === "facturacion-mes");
    expect(facturacionMes?.trendText).toBe("↑ 100% vs mes anterior");
    expect(facturacionMes?.trendTone).toBe("up");
  });

  it("computa facturación YTD acumulando desde el 1 de enero del año actual", () => {
    const salesDocs: RawSalesDocForKpi[] = [
      // Factura de febrero 2026
      {
        id: "1",
        doc_type: "FACTURA",
        status: "COBRADA",
        total: 120000000,
        cobrado_amount: 120000000,
        currency: "PYG",
        issue_date: "2026-02-10",
        due_date: null,
      },
      // Factura de septiembre 2026
      {
        id: "2",
        doc_type: "FACTURA",
        status: "EMITIDA",
        total: 80000000,
        cobrado_amount: 0,
        currency: "PYG",
        issue_date: "2026-09-12",
        due_date: null,
      },
      // Factura del año pasado 2025: no debe entrar en YTD
      {
        id: "3",
        doc_type: "FACTURA",
        status: "COBRADA",
        total: 500000000,
        cobrado_amount: 500000000,
        currency: "PYG",
        issue_date: "2025-11-20",
        due_date: null,
      },
    ];

    const kpis = computeAdminKpis({
      todayIso,
      salesDocs,
      receipts: [],
      invoices: [],
      cuentas: [],
      orders: [],
      cashflowItems: [],
      showSalesKpis: true,
      showInvoiceKpis: true,
    });

    const ytdKpi = kpis.find((k) => k.key === "facturacion-ytd");
    expect(ytdKpi).toBeDefined();
    // 120M + 80M = 200M PYG
    expect(ytdKpi?.value).toContain("200.000.000");
    expect(ytdKpi?.secondaryText).toBe("2 facturas en 2026");
  });

  it("computa cobrado este mes a partir de sales_receipts efectivos", () => {
    const receipts: RawReceiptForKpi[] = [
      { id: "r1", amount: 45000000, receipt_date: "2026-09-02", sales_document_id: "s1", currency: "PYG" },
      { id: "r2", amount: 35000000, receipt_date: "2026-09-18", sales_document_id: "s2", currency: "PYG" },
      // Recibo de mes anterior
      { id: "r3", amount: 90000000, receipt_date: "2026-08-30", sales_document_id: "s3", currency: "PYG" },
    ];

    const kpis = computeAdminKpis({
      todayIso,
      salesDocs: [],
      receipts,
      invoices: [],
      cuentas: [],
      orders: [],
      cashflowItems: [],
      showSalesKpis: true,
      showInvoiceKpis: true,
    });

    const cobradoKpi = kpis.find((k) => k.key === "cobrado-mes");
    expect(cobradoKpi).toBeDefined();
    expect(cobradoKpi?.value).toContain("80.000.000");
    expect(cobradoKpi?.secondaryText).toContain("2 cobros");
  });

  it("computa cuentas por cobrar (CxC) con desglose vencido", () => {
    const salesDocs: RawSalesDocForKpi[] = [
      // Emitida al día: saldo 50M
      {
        id: "1",
        doc_type: "FACTURA",
        status: "EMITIDA",
        total: 50000000,
        cobrado_amount: 0,
        currency: "PYG",
        issue_date: "2026-09-10",
        due_date: "2026-09-30",
      },
      // Emitida vencida: total 60M, cobrado 20M, saldo 40M
      {
        id: "2",
        doc_type: "FACTURA",
        status: "COBRADA_PARCIAL",
        total: 60000000,
        cobrado_amount: 20000000,
        currency: "PYG",
        issue_date: "2026-08-01",
        due_date: "2026-08-31", // vencido
      },
    ];

    const kpis = computeAdminKpis({
      todayIso,
      salesDocs,
      receipts: [],
      invoices: [],
      cuentas: [],
      orders: [],
      cashflowItems: [],
      showSalesKpis: true,
      showInvoiceKpis: true,
    });

    const cxcKpi = kpis.find((k) => k.key === "cuentas-por-cobrar");
    expect(cxcKpi).toBeDefined();
    // Saldo total = 50M + 40M = 90M
    expect(cxcKpi?.value).toContain("90.000.000");
    expect(cxcKpi?.secondaryText).toContain("Vencido: 40.000.000 PYG · 1 docs");
    expect(cxcKpi?.tone).toBe("error");
  });

  it("computa cuentas por pagar (CxP) y compras comprometidas (OC abiertas)", () => {
    const invoices: RawInvoiceForKpi[] = [
      // Factura pendiente futura
      { id: "i1", invoice_number: "001-001", total: 30000000, currency: "PYG", due_date: "2026-09-28", status: "APTO_PARA_PAGO" },
      // Factura pendiente vencida
      { id: "i2", invoice_number: "001-002", total: 20000000, currency: "PYG", due_date: "2026-09-10", status: "REQUIERE_REVISION" },
      // Factura pagada: no debe sumar
      { id: "i3", invoice_number: "001-003", total: 15000000, currency: "PYG", due_date: "2026-09-01", status: "PAGADO" },
    ];

    const orders: RawOrderForKpi[] = [
      // OC abierta con saldo por facturar 10M
      { id: "o1", code: "OC-1", total_price: 50000000, facturado_amount: 40000000, currency: "PYG" },
      // OC totalmente facturada
      { id: "o2", code: "OC-2", total_price: 20000000, facturado_amount: 20000000, currency: "PYG" },
    ];

    const kpis = computeAdminKpis({
      todayIso,
      salesDocs: [],
      receipts: [],
      invoices,
      cuentas: [],
      orders,
      cashflowItems: [],
      showSalesKpis: true,
      showInvoiceKpis: true,
    });

    const cxpKpi = kpis.find((k) => k.key === "cuentas-por-pagar");
    expect(cxpKpi?.value).toContain("50.000.000");
    expect(cxpKpi?.secondaryText).toContain("Vencido: 20.000.000 PYG · 1 facturas");
    expect(cxpKpi?.tone).toBe("error");

    const comprasKpi = kpis.find((k) => k.key === "compras-comprometidas");
    expect(comprasKpi?.value).toContain("10.000.000");
    expect(comprasKpi?.secondaryText).toContain("1 orden de compra abierta");
  });

  it("NUNCA mezcla monedas distintas y las formatea por separado", () => {
    const cuentas: RawCuentaFinancieraForKpi[] = [
      { id: "c1", nombre: "Itaú PYG", moneda: "PYG", saldo: 500000000, activo: true },
      { id: "c2", nombre: "Continental USD", moneda: "USD", saldo: 15000, activo: true },
    ];

    const kpis = computeAdminKpis({
      todayIso,
      salesDocs: [],
      receipts: [],
      invoices: [],
      cuentas,
      orders: [],
      cashflowItems: [],
      showSalesKpis: true,
      showInvoiceKpis: true,
    });

    const liquidezKpi = kpis.find((k) => k.key === "liquidez-disponible");
    expect(liquidezKpi?.value).toContain("500.000.000");
    expect(liquidezKpi?.multiCurrencyExtra).toBe("+ USD 15.000");
  });

  it("recupera los cuatro KPIs inferiores con vencimientos y monedas correctos", () => {
    const invoices: RawInvoiceForKpi[] = [
      { id: "upcoming", invoice_number: "F-1", total: 100000, currency: "PYG", due_date: "2026-09-25", status: "APTO_PARA_PAGO" },
      { id: "overdue", invoice_number: "F-2", total: 20000, currency: "PYG", due_date: "2026-09-18", status: "PENDIENTE" },
      { id: "far", invoice_number: "F-3", total: 90000, currency: "PYG", due_date: "2026-11-01", status: "PENDIENTE" },
    ];
    const salesDocs: RawSalesDocForKpi[] = [
      { id: "sale-overdue", doc_type: "FACTURA", status: "COBRADA_PARCIAL", total: 1000, cobrado_amount: 300, currency: "PYG", issue_date: "2026-08-01", due_date: "2026-09-10" },
      { id: "sale-current", doc_type: "FACTURA", status: "EMITIDA", total: 500, cobrado_amount: 0, currency: "PYG", issue_date: "2026-09-01", due_date: "2026-09-25" },
    ];
    const cards = computeAdminSecondaryKpis({
      todayIso,
      invoices,
      salesDocs,
      cashflowItems: [
        { tipo: "cobro_factura", descripcion: "Factura", fecha: "2026-09-25", monto: 300, moneda: "PYG", project_id: null, ref_id: "sale-current" },
        { tipo: "cobro_certificado", descripcion: "Certificado", fecha: "2026-10-01", monto: 50, moneda: "USD", project_id: "p1", ref_id: "cert1" },
        { tipo: "pago_factura", descripcion: "Pago", fecha: "2026-09-25", monto: -10, moneda: "PYG", project_id: null, ref_id: "i1" },
      ],
      showSalesKpis: true,
      showInvoiceKpis: true,
    });

    expect(cards.map((card) => card.key)).toEqual([
      "pagos-proximos", "cobros-esperados", "cxp-vencidas", "cxc-vencidas",
    ]);
    expect(cards[0].value).toContain("100.000");
    expect(cards[1].value).toContain("300");
    expect(cards[1].multiCurrencyExtra).toBe("+ USD 50");
    expect(cards[2].value).toContain("20.000");
    expect(cards[3].value).toContain("700");
  });
});
