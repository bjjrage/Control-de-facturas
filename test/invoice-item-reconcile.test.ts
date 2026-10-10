import { describe, expect, it } from "vitest";
import {
  unitsCompatible,
  normalizeDescription,
  orderLineRemaining,
  compareInvoiceQuantitySum,
  suggestInvoiceItemMatches,
  validateManualItemMatch,
  isValidInvoiceQuantity,
  formatInvoiceQuantity,
  subtractInvoiceQuantitySumExact,
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
    expect(proposals.map((p) => Number(p.quantityMatched)).sort((a, b) => a - b)).toEqual([60, 2500]);
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

  it("preserva una cantidad física de cuatro decimales en la propuesta", () => {
    const proposals = suggestInvoiceItemMatches(
      [line({ quantity: 1.2345 })],
      [orderLine({ quantity: 60, quantity_invoiced: 58.7655 })],
    );
    expect(proposals).toEqual([{ invoiceItemId: "il-1", orderItemId: "ol-1", quantityMatched: 1.2345, overRemaining: false }]);
  });

  it("compara el remanente con suma decimal exacta en el límite", () => {
    const exact = suggestInvoiceItemMatches(
      [line({ quantity: 1.2345 })],
      [orderLine({ quantity: 60, quantity_invoiced: 58.7655 })],
    );
    const over = suggestInvoiceItemMatches(
      [line({ quantity: 1.2345 })],
      [orderLine({ quantity: 60, quantity_invoiced: 58.7656 })],
    );
    expect(exact[0].overRemaining).toBe(false);
    expect(over[0].overRemaining).toBe(true);
  });

  it("compara una OC válida por encima del rango histórico de la línea de factura", () => {
    const orderQuantity = "1000000000001";
    const proposals = suggestInvoiceItemMatches(
      [line({ quantity: 0.0001 })],
      [orderLine({ quantity: orderQuantity, quantity_invoiced: 0 })],
    );
    expect(proposals[0].overRemaining).toBe(false);
    expect(isValidInvoiceQuantity(orderQuantity)).toBe(false);
    expect(compareInvoiceQuantitySum([0, 0.0001], orderQuantity)).toBe(-1);
  });

  it("mantiene cantidades grandes como texto decimal exacto", () => {
    expect(isValidInvoiceQuantity("999999999999.0000")).toBe(true);
    expect(isValidInvoiceQuantity("999999999999.00001")).toBe(false);
    expect(isValidInvoiceQuantity(Number("999999999999.00001"))).toBe(false);
    expect(compareInvoiceQuantitySum(["999999999999.0000"], "999999999999.0001")).toBe(-1);
    expect(subtractInvoiceQuantitySumExact("3000.0000", ["2999.9999"])).toBe("0.0001");
    expect(compareInvoiceQuantitySum(["1.2300"], "1.2345")).toBe(-1);
    expect(subtractInvoiceQuantitySumExact("1.2345", ["1.2300"])).toBe("0.0045");
    expect(formatInvoiceQuantity("0.0001")).toBe("0,0001");
    expect(formatInvoiceQuantity("999999999999.0001")).toBe("999.999.999.999,0001");
  });

  it("no propone una cantidad con precisión efectiva mayor a cuatro decimales", () => {
    expect(suggestInvoiceItemMatches([line({ quantity: 1.23456 })], [orderLine()])).toEqual([]);
  });
});

describe("validateManualItemMatch (confirmación humana explícita)", () => {
  const base = {
    invoiceEmpresaId: "emp-1", orderEmpresaId: "emp-1", invoiceStatus: "MATCH",
    invoiceLine: { id: "il-1", invoice_id: "inv-1", description: "Ladrillo común", quantity: 2500, unit: "un" },
    orderLine: { id: "ol-1", product: "Ladrillo común", quantity: 3000, unit: "un", quantity_invoiced: 0 },
    invoiceLineCount: 1, orderLineCount: 1,
    quantity: 2500, existingLineMatched: 0, duplicateExists: false,
  };

  it("acepta el caso válido (cantidad exacta documentada)", () => {
    expect(validateManualItemMatch(base)).toEqual({ ok: true, overRemaining: false });
  });

  it("acepta cantidad menor a la documentada", () => {
    expect(validateManualItemMatch({ ...base, quantity: 1000 }).ok).toBe(true);
  });

  it("acepta fracción finita válida (el esquema es numeric, sin regla de enteros)", () => {
    expect(validateManualItemMatch({ ...base, quantity: 2500.5, invoiceLine: { ...base.invoiceLine, quantity: 2500.5 } }).ok).toBe(true);
  });

  it("acepta 1.2345 y rechaza una quinta cifra sin redondearla", () => {
    const valid = validateManualItemMatch({
      ...base,
      invoiceLine: { ...base.invoiceLine, quantity: 1.2345 },
      orderLine: { ...base.orderLine, quantity: 60 },
      quantity: 1.2345,
    });
    expect(valid.ok).toBe(true);
    expect(validateManualItemMatch({ ...base, quantity: 1.23456 }).ok).toBe(false);
  });

  it("acepta una suma fraccionaria exacta igual al remanente y bloquea el exceso", () => {
    const args = {
      ...base,
      invoiceLine: { ...base.invoiceLine, quantity: 1.2345 },
      orderLine: { ...base.orderLine, quantity: 60, quantity_invoiced: 58.7655 },
      quantity: 1.2345,
    };
    expect(validateManualItemMatch(args).ok).toBe(true);
    expect(validateManualItemMatch({ ...args, orderLine: { ...args.orderLine, quantity_invoiced: 58.7656 } }).ok).toBe(false);
  });

  it("la política admite ceros finales y mantiene el rango común de factura", () => {
    expect(isValidInvoiceQuantity(60)).toBe(true); // 60.0000 al serializar desde UI/worker
    expect(isValidInvoiceQuantity(3000)).toBe(true);
    expect(isValidInvoiceQuantity(1.2345)).toBe(true);
    expect(isValidInvoiceQuantity(1.23456)).toBe(false);
    expect(isValidInvoiceQuantity(1_000_000_000_000)).toBe(false);
  });

  it("rechaza cantidad no finita (NaN)", () => {
    expect(validateManualItemMatch({ ...base, quantity: NaN }).ok).toBe(false);
  });

  it("rechaza cantidad mayor a la documentada", () => {
    const result = validateManualItemMatch({ ...base, quantity: 2501 });
    expect(result.ok).toBe(false);
  });

  it("rechaza la segunda imputación que supera el acumulado documentado", () => {
    // Línea de 2500 con 1000 ya imputados: 1000 + 1600 > 2500.
    const result = validateManualItemMatch({ ...base, quantity: 1600, existingLineMatched: 1000 });
    expect(result.ok).toBe(false);
    expect(result).toEqual({ ok: false, error: expect.stringContaining("documentada") });
    // En cambio 1000 + 1500 = 2500 es válido.
    expect(validateManualItemMatch({ ...base, quantity: 1500, existingLineMatched: 1000 }).ok).toBe(true);
  });

  it("rechaza línea sin cantidad documentada (sin conciliar, no cero)", () => {
    const result = validateManualItemMatch({
      ...base,
      invoiceLine: { ...base.invoiceLine, quantity: null },
    });
    expect(result).toEqual({ ok: false, error: "La línea no tiene cantidad documentada; no se puede imputar." });
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
    const result = validateManualItemMatch({
      ...base,
      invoiceLine: { ...base.invoiceLine, unit: "kg" },
    });
    expect(result.ok).toBe(false);
    expect(result).toEqual({ ok: false, error: "La unidad de la línea de factura no coincide con la de la OC." });
  });

  it("rechaza duplicados", () => {
    const result = validateManualItemMatch({ ...base, duplicateExists: true });
    expect(result.ok).toBe(false);
  });

  it("rechaza (no solo avisa) cuando supera el remanente: R3-02 regla B", () => {
    // Línea documentada por 3500, remanente 3000: excede el remanente.
    const result = validateManualItemMatch({
      ...base,
      invoiceLine: { ...base.invoiceLine, quantity: 3500 },
      quantity: 3500,
    });
    expect(result.ok).toBe(false);
    expect(result).toEqual({
      ok: false,
      error: "La cantidad supera el remanente de la OC (3000 pendientes). Queda sin conciliar.",
    });
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
