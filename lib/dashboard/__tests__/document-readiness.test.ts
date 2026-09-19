import { describe, it, expect } from "vitest";
import {
  normalizeDocumentType,
  evaluateRequirementReadiness,
  assessTendersReadiness,
  RawEmpresaDocumento,
  RawLicitacionForReadiness,
  RawLicitacionDocumento,
} from "../document-readiness";
import type { ExtractedTenderRequirement } from "../types";

const todayIso = "2026-09-19";

describe("Document Readiness Engine V1", () => {
  describe("normalizeDocumentType", () => {
    it("normaliza certificados tributarios SET / DNIT / CCT", () => {
      expect(normalizeDocumentType("Certificado de Cumplimiento Tributario").normalizedType).toBe(
        "CERTIFICADO_CUMPLIMIENTO_TRIBUTARIO"
      );
      expect(normalizeDocumentType("CCT DNIT").normalizedType).toBe(
        "CERTIFICADO_CUMPLIMIENTO_TRIBUTARIO"
      );
    });

    it("normaliza constancias de IPS", () => {
      expect(normalizeDocumentType("Constancia de no adeudar IPS").normalizedType).toBe(
        "CONSTANCIA_IPS"
      );
      expect(normalizeDocumentType("Aportes Obrero Patronal").normalizedType).toBe(
        "CONSTANCIA_IPS"
      );
    });

    it("normaliza declaraciones juradas de inhabilitación (Art. 40)", () => {
      expect(normalizeDocumentType("Declaración Jurada Art. 40 Ley 2051").normalizedType).toBe(
        "DECLARACION_JURADA_ART_40"
      );
    });

    it("clasifica como OTRO si no coincide con el catálogo", () => {
      expect(normalizeDocumentType("Certificado de curso de cocina").normalizedType).toBe(
        "OTRO"
      );
    });
  });

  describe("evaluateRequirementReadiness", () => {
    const req: ExtractedTenderRequirement = {
      id: "req-1",
      licitacion_id: "lic-1",
      normalized_type: "CONSTANCIA_IPS",
      source_text: "Constancia IPS",
      required: true,
      confidence: 0.95,
    };

    it("retorna READY si el documento está vigente hoy y cubre la fecha de entrega de oferta", () => {
      const docs: RawEmpresaDocumento[] = [
        {
          id: "doc-1",
          tipo: "Constancia IPS",
          fecha_vencimiento: "2026-10-30", // vence después de la oferta
        },
      ];

      const res = evaluateRequirementReadiness(req, docs, "2026-09-28", todayIso);
      expect(res.status).toBe("READY");
      expect(res.matchingDoc?.id).toBe("doc-1");
    });

    it("retorna EXPIRING_BEFORE_DEADLINE si está vigente hoy pero vence antes de la entrega", () => {
      // Ejemplo conceptual del usuario:
      // Requisito: Constancia IPS
      // Documento empresa: vence 25/09
      // Fecha entrega licitación: 28/09
      // Resultado: EXPIRING_BEFORE_DEADLINE
      const docs: RawEmpresaDocumento[] = [
        {
          id: "doc-1",
          tipo: "Constancia IPS",
          fecha_vencimiento: "2026-09-25",
        },
      ];

      const res = evaluateRequirementReadiness(req, docs, "2026-09-28", todayIso);
      expect(res.status).toBe("EXPIRING_BEFORE_DEADLINE");
      expect(res.reason).toContain("antes de la entrega de ofertas");
    });

    it("retorna EXPIRED si el documento ya está vencido hoy", () => {
      const docs: RawEmpresaDocumento[] = [
        {
          id: "doc-1",
          tipo: "Constancia IPS",
          fecha_vencimiento: "2026-09-10", // anterior a todayIso (2026-09-19)
        },
      ];

      const res = evaluateRequirementReadiness(req, docs, "2026-09-28", todayIso);
      expect(res.status).toBe("EXPIRED");
    });

    it("retorna MISSING si no existe ningún documento en la bóveda", () => {
      const docs: RawEmpresaDocumento[] = [];
      const res = evaluateRequirementReadiness(req, docs, "2026-09-28", todayIso);
      expect(res.status).toBe("MISSING");
    });
  });

  describe("assessTendersReadiness (Evaluación Integral de Licitaciones)", () => {
    it("marca isAtRisk = true y fail-closed si la licitación no tiene pliego analizado", () => {
      const lic: RawLicitacionForReadiness = {
        id: "lic-1",
        titulo: "Licitación sin pliego",
        dncp_nro: "123456",
        fecha_entrega_ofertas: "2026-09-30",
        decision: "EN_PREPARACION",
      };

      const results = assessTendersReadiness({
        licitaciones: [lic],
        docs: [], // sin documentos
        empresaDocs: [],
        todayIso,
      });

      expect(results[0].hasAnalyzedPbc).toBe(false);
      expect(results[0].isAtRisk).toBe(true);
    });

    it("detecta licitaciones en riesgo cuando falta un documento requerido del pliego", () => {
      const lic: RawLicitacionForReadiness = {
        id: "lic-1",
        titulo: "Construcción de Escuela",
        dncp_nro: "391731",
        fecha_entrega_ofertas: "2026-09-28",
        decision: "EN_PREPARACION",
      };

      const licDocs: RawLicitacionDocumento[] = [
        {
          id: "ld-1",
          licitacion_id: "lic-1",
          tipo: "biddingDocuments",
          tipo_detalle: "Pliego de Bases y Condiciones",
          titulo: "PBC Escuela.pdf",
          url_dncp: "https://dncp.gov.py/pbc.pdf",
        },
      ];

      // La empresa solo tiene CCT, pero le falta IPS
      const empresaDocs: RawEmpresaDocumento[] = [
        { id: "ed-1", tipo: "CCT DNIT", fecha_vencimiento: "2026-11-01" },
      ];

      const results = assessTendersReadiness({
        licitaciones: [lic],
        docs: licDocs,
        empresaDocs,
        todayIso,
      });

      expect(results[0].hasAnalyzedPbc).toBe(true);
      expect(results[0].isAtRisk).toBe(true);
      expect(results[0].missingCount).toBeGreaterThan(0);
    });
  });
});
