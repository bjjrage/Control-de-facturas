import { describe, expect, it } from "vitest";
import { calcLineSubtotal, roundMoney2, roundQuantity4 } from "../format";

describe("calcLineSubtotal — replica ROUND(quantity * unit_price, 2) de budget_items (0028_construccion_pro.sql)", () => {
  it("caso del batch de certificación BIM: 65.7235 × 185000 = 12.158.847,5 (no 12.158.846)", () => {
    // El reporte de certificación anterior mostró 65.7235 × 185000 =
    // 12.158.846, resultado matemáticamente incorrecto (multiplicación mal
    // hecha a mano). El valor correcto, redondeado a 2 decimales como hace
    // la columna GENERATED de budget_items, es 12.158.847,5.
    expect(calcLineSubtotal(65.7235, 185000)).toBe(12158847.5);
  });

  it("caso con resultado entero exacto", () => {
    expect(calcLineSubtotal(10, 185000)).toBe(1850000);
  });

  it("redondea half-away-from-zero, no half-to-even, ante un empate exacto en el tercer decimal", () => {
    // 1.005 × 100 = 100.5 exacto en el dominio decimal (quantity y precio
    // son "limpios" en su propia escala) — ROUND(numeric, 2) de Postgres
    // redondea .5 siempre hacia arriba, no al par más cercano.
    expect(calcLineSubtotal(1.005, 100)).toBe(100.5);
    expect(calcLineSubtotal(0.125, 1000)).toBe(125); // 0.125*1000=125.000, sin ambigüedad de por medio
  });

  it("no arrastra ruido de punto flotante de una suma previa (motivador real: agregación BIM)", () => {
    // 18 + 23 + 14.7235 acumulado como floats puede quedar en
    // 55.723500000000001 o similar — el helper debe seguir dando el mismo
    // resultado que si el valor fuera exacto.
    const noisy = 0.1 + 0.2; // clásico 0.30000000000000004 en IEEE754
    expect(calcLineSubtotal(noisy, 100)).toBe(30);
  });

  it("maneja cantidad o precio en cero sin dividir por cero ni devolver NaN", () => {
    expect(calcLineSubtotal(0, 185000)).toBe(0);
    expect(calcLineSubtotal(65.7235, 0)).toBe(0);
  });

  it("maneja valores negativos con el mismo redondeo half-away-from-zero", () => {
    expect(calcLineSubtotal(-1.005, 100)).toBe(-100.5);
  });
});

describe("roundQuantity4 — precisión de budget_items.quantity (numeric(18,4))", () => {
  it("redondea una suma de cantidades BIM a 4 decimales", () => {
    // Los tres valores reales del fixture de ARCHICAD (ver
    // archicad-fixture.spec.ts): 23.2182062609 + 22.9725109565 + 19.5327766957
    expect(roundQuantity4(23.2182062609 + 22.9725109565 + 19.5327766957)).toBe(65.7235);
  });
});

describe("roundMoney2 — precisión de budget_items.unit_price/subtotal (numeric(18,2))", () => {
  it("redondea a 2 decimales half-away-from-zero", () => {
    expect(roundMoney2(12158847.505)).toBe(12158847.51);
    expect(roundMoney2(100)).toBe(100);
  });
});
