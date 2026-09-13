import { describe, it, expect } from "vitest";
import { classifyPayable, classifyReceivable } from "./dashboard-kpis";

const today = "2026-06-15";
const windowEnd = "2026-06-22"; // today + 7 días

describe("classifyPayable (CxP — facturas de proveedor)", () => {
  it("factura proveedor futura + no pagada -> pagos próximos", () => {
    expect(classifyPayable({ status: "APTO_PARA_PAGO", due_date: "2026-06-18" }, today, windowEnd)).toBe("proxima");
  });

  it("factura proveedor vencida + no pagada -> CxP vencida", () => {
    expect(classifyPayable({ status: "APTO_PARA_PAGO", due_date: "2026-06-01" }, today, windowEnd)).toBe("vencida");
  });

  it("factura proveedor vencida pero pagada -> no cuenta", () => {
    expect(classifyPayable({ status: "PAGADO", due_date: "2026-06-01" }, today, windowEnd)).toBeNull();
  });

  it("factura sin due_date -> no clasificable, no cuenta", () => {
    expect(classifyPayable({ status: "APTO_PARA_PAGO", due_date: null }, today, windowEnd)).toBeNull();
  });

  it("factura futura pero fuera de la ventana -> no cuenta como próxima", () => {
    expect(classifyPayable({ status: "APTO_PARA_PAGO", due_date: "2026-07-01" }, today, windowEnd)).toBeNull();
  });

  it("factura no pagada en cualquier status previo a APTO_PARA_PAGO también es obligación pendiente", () => {
    expect(classifyPayable({ status: "REQUIERE_REVISION", due_date: "2026-06-01" }, today, windowEnd)).toBe("vencida");
  });

  it("due_date exactamente hoy -> todavía no está vencida, cuenta como próxima", () => {
    expect(classifyPayable({ status: "APTO_PARA_PAGO", due_date: today }, today, windowEnd)).toBe("proxima");
  });
});

describe("classifyReceivable (CxC — documentos de venta)", () => {
  it("venta futura + saldo > 0 -> cobro esperado", () => {
    expect(
      classifyReceivable({ status: "EMITIDA", due_date: "2026-06-20", total: 1000, cobrado_amount: 0 }, today, windowEnd)
    ).toBe("esperado");
  });

  it("venta vencida + saldo > 0 -> CxC vencida", () => {
    expect(
      classifyReceivable({ status: "EMITIDA", due_date: "2026-06-01", total: 1000, cobrado_amount: 0 }, today, windowEnd)
    ).toBe("vencido");
  });

  it("venta vencida pero totalmente cobrada -> no cuenta", () => {
    expect(
      classifyReceivable({ status: "COBRADA", due_date: "2026-06-01", total: 1000, cobrado_amount: 1000 }, today, windowEnd)
    ).toBeNull();
  });

  it("venta vencida con cobro parcial (saldo > 0) -> sigue siendo CxC vencida", () => {
    expect(
      classifyReceivable(
        { status: "COBRADA_PARCIAL", due_date: "2026-06-01", total: 1000, cobrado_amount: 400 },
        today,
        windowEnd
      )
    ).toBe("vencido");
  });

  it("documento en BORRADOR no es una cuenta por cobrar real -> no cuenta", () => {
    expect(
      classifyReceivable({ status: "BORRADOR", due_date: "2026-06-01", total: 1000, cobrado_amount: 0 }, today, windowEnd)
    ).toBeNull();
  });

  it("documento ANULADA no se debe -> no cuenta aunque el saldo diera positivo", () => {
    expect(
      classifyReceivable({ status: "ANULADA", due_date: "2026-06-01", total: 1000, cobrado_amount: 0 }, today, windowEnd)
    ).toBeNull();
  });

  it("documento sin due_date -> no clasificable, no cuenta", () => {
    expect(
      classifyReceivable({ status: "EMITIDA", due_date: null, total: 1000, cobrado_amount: 0 }, today, windowEnd)
    ).toBeNull();
  });

  it("venta futura fuera de la ventana -> no cuenta como esperada", () => {
    expect(
      classifyReceivable({ status: "EMITIDA", due_date: "2026-08-01", total: 1000, cobrado_amount: 0 }, today, windowEnd)
    ).toBeNull();
  });
});
