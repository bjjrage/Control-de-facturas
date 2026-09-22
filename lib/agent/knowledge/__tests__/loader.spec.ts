import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ERP_KNOWLEDGE_DOCUMENTS, formatKnowledgeContext, retrieveErpKnowledge, selectRelevantKnowledge } from "../index";

describe("ERP knowledge loader", () => {
  it("no carga conocimiento para un saludo simple", () => {
    expect(selectRelevantKnowledge("Hola Rodrigo")).toEqual([]);
    expect(selectRelevantKnowledge("Buenas, ¿qué tal?")).toEqual([]);
  });

  it("selecciona inventario para una consulta de stock/materiales", () => {
    const matches = selectRelevantKnowledge("¿Tenemos stock de cemento para la obra?");
    expect(matches.map((match) => match.document.id)).toContain("inventory");
    expect(formatKnowledgeContext(matches)).toContain("stock global");
  });

  it("combina plan semanal e inventario para abastecimiento", () => {
    const matches = selectRelevantKnowledge("Necesito materiales para el plan semanal de la obra");
    const ids = matches.map((match) => match.document.id);
    expect(ids).toContain("weekly-planning");
    expect(ids).toContain("inventory");
  });

  it("selecciona licitaciones sin mezclarla con compras internas por defecto", () => {
    const matches = selectRelevantKnowledge("Analizá la licitación, sus lotes y oferentes");
    expect(matches[0]?.document.id).toBe("tenders");
  });

  it("expone el límite duro de tesorería", () => {
    const matches = selectRelevantKnowledge("Quiero pagar una factura y transferir dinero");
    const context = formatKnowledgeContext(matches);
    expect(matches.map((match) => match.document.id)).toContain("finance-and-treasury");
    expect(context).toMatch(/Nunca debe pagar, cobrar, transferir/i);
  });

  it("mantiene el manual trazable a los archivos creados", () => {
    for (const document of ERP_KNOWLEDGE_DOCUMENTS) {
      expect(existsSync(join(process.cwd(), document.docPath))).toBe(true);
    }
  });

  it("get_erp_knowledge devuelve solo contexto estático", () => {
    const matches = retrieveErpKnowledge("RFQ y proveedores");
    expect(matches.map((match) => match.content).join(" ")).not.toContain("rfq_responses_actuales");
    expect(matches.every((match) => match.sourceMap.length > 0)).toBe(true);
  });
});
