import { describe, expect, it } from "vitest";
import {
  unitsCompatible,
  normalizeDescription,
  orderLineRemaining,
  suggestInvoiceItemMatches,
  validateManualItemMatch,
  type ReconcilableInvoiceLine,
  type ReconcilableOrderLine,
} from "@/lib/invoice-item-reconcile";

const line = (over: Partial<ReconcilableInvoiceLine> = {}): ReconcilableInvoiceLine => ({
  id: "il-1", invoice_id: "inv-1", empresa_id: "emp-1",
  product_description: "Ladrillo común", quantity: 2500, unit: "un", ...over,
});
const orderLine = (over: Partial<ReconcilableOrderLine> = {}): ReconcilableOrderLine => ({
  id: "ol-1", order_id: "oc-1", empresa_id: "emp-1",
  product: "Ladrillo común", quantity: 3000, unit: "un", quantity_invoiced: 0, ...over,
});

describe("normalización de unidades", () => {
  it.each([
    ["un", "unidades", true], ["UN", "unidad", true], ["bolsa", "bolsas", true],
    ["m²", "m2", true], ["M3", "m³", true], ["kg", "KG", true], ["L", "lt", true],
  ])("'%s' compatible con '%s'", (a, b, expected) => {
    expect(unitsCompatible(a, b)).toBe(expected);
  });

  it.each([["bolsa", "un"], ["kg", "m"], ["", "un"], [null, "un"]])("'%s' incompatible con '%s'", (a, b) => {
    expect(unitsCompatible(a, b)).toBe(false);
  });

  it("normaliza descripciones para comparar (tildes, puntuación, espacios)", () => {
    expect(normalizeDescription("Ladrillo común — cantidad efectivamente recibida.")).toBe(
      "ladrillo comun cantidad efectivamente recibida"
    );
  });
});

describe("suggestInvoiceItemMatches (caso inequívoco)", () => {
  it("OC 3000 ladrillos + factura 2500 → imputa 2500 (cantidad propia de la línea)", () => {
    const proposals = suggestInvoiceItemMatches([line()], [orderLine()]);
    expect(proposals).toEqual([{ invoiceItemId: "il-1", orderItemId: "ol-1", quantityMatched: 2500, overRemaining: false }]);
  });

  it("dos facturas parciales acumulan sin duplicar (1000 + 1500 sobre 3000)", () => {
    const first = suggestInvoiceItemMatches(
      [line({ id: "il-1", quantity: 1000 })],
      [orderLine()]
    );
    expect(first[0].quantityMatched).toBe(1000);
    const second = suggestInvoiceItemMatches(
      [line({ id: "il-2", quantity: 1500 })],
      [orderLine({ quantity_invoiced: 1000 })]
    );
    expect(second[0].quantityMatched).toBe(1500);
    expect(1000 + 1500).toBe(2500);
  });

  it("dos productos concilian individualmente", () => {
    const proposals = suggestInvoiceItemMatches(
      [line({ id: "il-1", product_description: "Cemento Portland 50 kg", quantity: 60, unit: "bolsa" }),
       line({ id: "il-2", product_description: "Ladrillo común", quantity: 2500, unit: "un" })],
      [orderLine({ id: "ol-1", product: "Cemento Portland 50 kg", quantity: 60, unit: "bolsa" }),
       orderLine({ id: "ol-2", product: "Ladrillo común", quantity: 3000, unit: "un" })]
    );
    expect(proposals).toHaveLength(2);
    expect(proposals.map((p) => p.quantityMatched).sort((a, b) => a - b)).toEqual([60, 2500]);
  });

  it("factura sin líneas verificables queda sin conciliar", () => {
    expect(suggestInvoiceItemMatches(
      [line({ product_description: "  ", quantity: null, unit: null })],
      [orderLine()]
    )).toEqual([]);
  });

  it("unidad incompatible no genera match", () => {
    expect(suggestInvoiceItemMatches(
      [line({ unit: "kg" })],
      [orderLine({ unit: "un" })]
    )).toEqual([]);
  });

  it("producto ambiguo (dos líneas de OC compatibles) no genera match", () => {
    expect(suggestInvoiceItemMatches(
      [line({ product_description: "Ladrillo" })],
      [orderLine({ id: "ol-1", product: "Ladrillo común" }), orderLine({ id: "ol-2", product: "Ladrillo hueco" })],
      { allowSingleToSingleFallback: false }
    )).toEqual([]);
  });

  it("cantidad superior al remanente se marca (no se crea silenciosamente)", () => {
    const proposals = suggestInvoiceItemMatches(
      [line({ quantity: 3500 })],
      [orderLine({ quantity: 3000, quantity_invoiced: 500 })]
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0].overRemaining).toBe(true);
    expect(orderLineRemaining(orderLine({ quantity: 3000, quantity_invoiced: 500 }))).toBe(2500);
  });

  it("nunca deduce dividiendo totales: usa la cantidad propia de la línea", () => {
    const proposals = suggestInvoiceItemMatches(
      [line({ quantity: 2500, unit: "un" })],
      [orderLine({ quantity: 3000, unit: "un" })]
    );
    expect(proposals[0].quantityMatched).toBe(2500);
    expect(proposals[0].quantityMatched).not.toBe(3000);
  });
});

describe("validateManualItemMatch (confirmación humana explícita)", () => {
  const base = {
    invoiceEmpresaId: "emp-1", orderEmpresaId: "emp-1", invoiceStatus: "MATCH",
    invoiceLine: { id: "il-1", invoice_id: "inv-1", description: "Ladrillo común", quantity: 2500, unit: "un" },
    orderLine: { id: "ol-1", product: "Ladrillo común", quantity: 3000, unit: "un", quantity_invoiced: 0 },
    invoiceLineCount: 1, orderLineCount: 1,
    quantity: 2500, duplicateExists: false,
  };

  it("acepta el caso válido", () => {
    expect(validateManualItemMatch(base)).toEqual({ ok: true, overRemaining: false });
  });

  it("rechaza producto de otra empresa", () => {
    expect(validateManualItemMatch({ ...base, orderEmpresaId: "emp-2" }).ok).toBe(false);
  });

  it("rechaza producto ajeno a la OC (sin correspondencia ni 1:1)", () => {
    const result = validateManualItemMatch({
      ...base,
      invoiceLine: { ...base.invoiceLine, description: "Cemento Portland" },
      invoiceLineCount: 2,
      orderLineCount: 2,
    });
    expect(result.ok).toBe(false);
    expect(result).toEqual({ ok: false, error: "El producto de la línea no corresponde al ítem de OC." });
  });

  it("acepta 1:1 aunque las descripciones difieran (mismo caso inequívoco)", () => {
    const result = validateManualItemMatch({
      ...base,
      invoiceLine: { ...base.invoiceLine, description: "Ladrillo común cantidad recibida" },
      invoiceLineCount: 1,
      orderLineCount: 1,
    });
    expect(result.ok).toBe(true);
  });

  it("rechaza unidad incompatible", () => {
    expect(validateManualItemMatch({
      ...base,
      invoiceLine: { ...base.invoiceLine, unit: "kg" },
    }).ok).toBe(false);
  });

  it("rechaza duplicados", () => {
    const result = validateManualItemMatch({ ...base, duplicateExists: true });
    expect(result.ok).toBe(false);
  });

  it("avisa (no bloquea) cuando supera el remanente: alerta para revisión", () => {
    const result = validateManualItemMatch({ ...base, quantity: 3500 });
    expect(result).toEqual({ ok: true, overRemaining: true });
  });

  it("rechaza cantidad no positiva", () => {
    expect(validateManualItemMatch({ ...base, quantity: 0 }).ok).toBe(false);
    expect(validateManualItemMatch({ ...base, quantity: -5 }).ok).toBe(false);
  });

  it("congela facturas aprobadas o pagadas", () => {
    for (const status of ["APTO_PARA_PAGO", "PAGADO"]) {
      expect(validateManualItemMatch({ ...base, invoiceStatus: status }).ok).toBe(false);
    }
  });

  it("rechaza factura de otra empresa (defensa en profundidad)", () => {
    expect(validateManualItemMatch({ ...base, invoiceEmpresaId: "emp-x" }).ok).toBe(false);
  });
});
