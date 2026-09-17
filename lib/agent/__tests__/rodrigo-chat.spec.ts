import { describe, expect, it } from "vitest";
import { formatToolAnswer, RODRIGO_HELP_MESSAGE, routeChatIntent } from "../rodrigo-chat";

const UUID_A = "00000000-0000-4000-a000-000000000001";
const UUID_B = "00000000-0000-4000-a000-000000000002";

describe("Rodrigo deterministic router", () => {
  it("planilla con UUID va a snapshot", () => {
    const r = routeChatIntent(`leé la planilla ${UUID_A}`);
    expect(r).toEqual({ kind: "tool", tool: "get_spreadsheet_snapshot", input: { planilla_id: UUID_A } });
  });

  it("planilla con rango A1 va a read_spreadsheet_range", () => {
    const r = routeChatIntent(`leé la planilla ${UUID_A} rango A18:H24`);
    expect(r).toEqual({
      kind: "tool",
      tool: "read_spreadsheet_range",
      input: { planilla_id: UUID_A, range: "A18:H24" },
    });
  });

  it("planilla sin UUID pide aclaración", () => {
    expect(routeChatIntent("leé la planilla").kind).toBe("clarify");
  });

  it("documento con UUID va a get_document_content", () => {
    const r = routeChatIntent(`extraé el documento ${UUID_A}`);
    expect(r).toEqual({ kind: "tool", tool: "get_document_content", input: { document_id: UUID_A } });
  });

  it("stock con producto UUID va a get_stock_availability", () => {
    const r = routeChatIntent(`¿cuánto stock tenemos del producto ${UUID_A}?`);
    expect(r.kind).toBe("tool");
    if (r.kind === "tool") {
      expect(r.tool).toBe("get_stock_availability");
      expect(r.input).toMatchObject({ producto_id: UUID_A });
    }
  });

  it("stock sin UUID pide aclaración", () => {
    expect(routeChatIntent("¿cuánto stock tenemos?").kind).toBe("clarify");
  });

  it("materiales con proyecto y comillas va a get_material_need", () => {
    const r = routeChatIntent(`¿faltan "cemento" y "varilla 10mm" en ${UUID_A}?`, null);
    expect(r).toEqual({
      kind: "tool",
      tool: "get_material_need",
      input: { project_id: UUID_A, material_descriptions: ["cemento", "varilla 10mm"] },
    });
  });

  it("usa el proyecto del workspace cuando viene dado", () => {
    const r = routeChatIntent("resumen del proyecto", UUID_B);
    expect(r).toEqual({ kind: "tool", tool: "get_project_context", input: { project_id: UUID_B } });
  });

  it("proveedores va a search_suppliers sin exigir IDs", () => {
    const r = routeChatIntent("buscá proveedores");
    expect(r).toEqual({ kind: "tool", tool: "search_suppliers", input: {} });
  });

  it("comparar con RFQ UUID va a compare_quotations", () => {
    const r = routeChatIntent(`compará las cotizaciones de ${UUID_A}`);
    expect(r).toEqual({ kind: "tool", tool: "compare_quotations", input: { rfq_id: UUID_A } });
  });

  it("ver RFQ va a get_rfq", () => {
    const r = routeChatIntent(`mostrame la RFQ ${UUID_A}`);
    expect(r).toEqual({ kind: "tool", tool: "get_rfq", input: { rfq_id: UUID_A } });
  });

  it("orden de compra pide datos y no ejecuta nada", () => {
    const r = routeChatIntent("preparame una orden de compra");
    expect(r.kind).toBe("clarify");
  });

  it("ayuda responde el mensaje de capacidades", () => {
    expect(routeChatIntent("ayuda")).toEqual({ kind: "help" });
    expect(RODRIGO_HELP_MESSAGE.length).toBeGreaterThan(20);
  });

  it("texto libre cae en clarify, nunca en tool inventado", () => {
    const r = routeChatIntent("lorem ipsum dolor");
    expect(r.kind).toBe("clarify");
  });
});

describe("formatToolAnswer", () => {
  it("resume stock sin inventar cifras", () => {
    expect(formatToolAnswer("get_stock_availability", { stock_actual: 42, reservado: 2, disponible: 40 })).toContain("42");
  });

  it("marca desconocidos en compare sin convertir a cero", () => {
    const text = formatToolAnswer("compare_quotations", {
      overall_summary: { suppliers_quoted: 2, items_with_price: 1, total_items: 3, has_unknowns: true },
    });
    expect(text).toContain("2");
    expect(text).toMatch(/desconocido/i);
  });

  it("tool desconocido responde genérico seguro", () => {
    expect(formatToolAnswer("algo_raro", {})).toContain("Listo");
  });
});
