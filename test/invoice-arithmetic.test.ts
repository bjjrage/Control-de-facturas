import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateInvoiceArithmetic } from "@/lib/invoice-arithmetic";
import type { ExtractedInvoiceFields } from "@/lib/invoice-extraction";

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");

const base: ExtractedInvoiceFields = {
  provider_name: "Cementos Paraguay QA S.A.",
  provider_tax_id: "800111112",
  invoice_number: "001-001-0000001",
  invoice_date: "2026-10-08",
  subtotal: 3709091,
  vat: 370909,
  total: 4080000,
  timbrado: "12345678",
  order_reference: "OC-2026-0004",
  product_description: "Cemento Portland 50 kg",
  items: [{ description: "Cemento Portland 50 kg", quantity: 60, unit: "bolsa", unit_price: 68000, subtotal: 4080000 }],
};

describe("prompts de extracción: null ante ilegible, sin estimación", () => {
  const source = readSource("lib/invoice-extraction.ts");

  it("ambos prompts exigen null incluido el total", () => {
    const nullCount = (source.match(/INCLUIDO el total/g) ?? []).length;
    expect(nullCount).toBeGreaterThanOrEqual(2);
  });

  it("ningún prompt pide estimar como dato definitivo", () => {
    const prompts = [...source.matchAll(/(?:PHOTO|PDF)_SYSTEM_PROMPT = `([\s\S]*?)`;/g)].map((m) => m[1]);
    expect(prompts).toHaveLength(2);
    for (const prompt of prompts) {
      expect(prompt).not.toMatch(/mejor estimaci|poné tu mejor|excepto "total"|total.*obligatorio/i);
      expect(prompt).toMatch(/INCLUIDO el total/i);
    }
  });

  it("el schema permite total null", () => {
    expect(source).toContain('total: { type: ["number", "null"]');
  });
});

describe("validateInvoiceArithmetic", () => {
  it("acepta extracción válida (60 × 68000 = 4080000; 3709091 + 370909 = 4080000)", () => {
    expect(validateInvoiceArithmetic(base)).toEqual({ status: "VALIDA", issues: [] });
  });

  it("detecta línea con subtotal inconsistente", () => {
    const result = validateInvoiceArithmetic({
      ...base,
      items: [{ description: "Cemento", quantity: 60, unit: "bolsa", unit_price: 68000, subtotal: 4800000 }],
    });
    expect(result.status).toBe("REVISION");
    expect(result.issues.join(" ")).toMatch(/60 × 68000/);
  });

  it("detecta total impreso inconsistente (INV-12: 4.8M vs 4.08M)", () => {
    const result = validateInvoiceArithmetic({ ...base, total: 4800000 });
    expect(result.status).toBe("REVISION");
    expect(result.issues.join(" ")).toContain("4800000");
  });

  it("total ilegible o no positivo exige revisión (nunca definitivo)", () => {
    for (const total of [null, 0, -100]) {
      const result = validateInvoiceArithmetic({ ...base, total });
      expect(result.status).toBe("REVISION");
    }
  });

  it("acepta redondeo de ±1 PYG en prorrateo de IVA", () => {
    expect(validateInvoiceArithmetic({ ...base, vat: 370911 }).status).toBe("REVISION");
    expect(validateInvoiceArithmetic({ ...base, vat: 370908 }).status).toBe("VALIDA");
    expect(validateInvoiceArithmetic({ ...base, vat: 370910 }).status).toBe("VALIDA");
  });

  it("IVA 5% + 10% mixto aritméticamente consistente valida", () => {
    const result = validateInvoiceArithmetic({
      ...base,
      subtotal: 3236364,
      vat: 223636,
      total: 3460000,
      items: [
        { description: "Yerba", quantity: 100, unit: "kg", unit_price: 21000, subtotal: 2100000 },
        { description: "Cemento", quantity: 20, unit: "bolsa", unit_price: 68000, subtotal: 1360000 },
      ],
    });
    // Líneas brutas empatan con el total y subtotal+IVA empata con el total: consistente.
    expect(result.status).toBe("VALIDA");
  });

  it("subtotal fusionado erróneo (caso real INV-08) requiere revisión", () => {
    const result = validateInvoiceArithmetic({
      ...base,
      subtotal: 3000000,
      vat: 223636,
      total: 3460000,
      items: [
        { description: "Yerba", quantity: 100, unit: "kg", unit_price: 21000, subtotal: 2100000 },
        { description: "Cemento", quantity: 20, unit: "bolsa", unit_price: 68000, subtotal: 1360000 },
      ],
    });
    // 3.000.000 + 223.636 = 3.223.636 ≠ 3.460.000: el subtotal está mal fusionado.
    expect(result.status).toBe("REVISION");
  });

  it("exentos no desagregados requieren revisión (sin doble conteo)", () => {
    const result = validateInvoiceArithmetic({
      ...base,
      subtotal: 2181818,
      vat: 218182,
      total: 3900000,
      items: [
        { description: "Libros (exento)", quantity: 10, unit: "un", unit_price: 150000, subtotal: 1500000 },
        { description: "Cable", quantity: 300, unit: "m", unit_price: 8000, subtotal: 2400000 },
      ],
    });
    // Suma de líneas (3.900.000) ≠ subtotal gravado (2.181.818): el exento no está
    // desagregado en el schema; se pide revisión en vez de sumar IVA dos veces.
    expect(result.status).toBe("REVISION");
  });

  it("descuento no desagregado requiere revisión", () => {
    const result = validateInvoiceArithmetic({
      ...base,
      subtotal: 2618182,
      vat: 261818,
      total: 2880000,
      items: [{ description: "Pintura", quantity: 10, unit: "balde", unit_price: 320000, subtotal: 3200000 }],
    });
    // La línea muestra el bruto (3.200.000) y la cabecera el neto (2.618.182):
    // el descuento no está desagregado; lo verifica un humano.
    expect(result.status).toBe("REVISION");
  });

  it("campos ausentes se omiten, no se inventan", () => {
    const result = validateInvoiceArithmetic({
      ...base,
      subtotal: null,
      vat: null,
      items: [{ description: "Algo", quantity: null, unit: null, unit_price: null, subtotal: null }],
    });
    // Solo el total 4080000 verificable contra nada: sin subtotal/IVA no hay chequeo → válida
    expect(result).toEqual({ status: "VALIDA", issues: [] });
  });

  it("cantidades no positivas se señalan", () => {
    const result = validateInvoiceArithmetic({
      ...base,
      items: [{ description: "Algo", quantity: 0, unit: "un", unit_price: 100, subtotal: 0 }],
    });
    expect(result.status).toBe("REVISION");
  });
});
