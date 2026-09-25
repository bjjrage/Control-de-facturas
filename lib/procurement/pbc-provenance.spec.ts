import { describe, expect, it } from "vitest";

import {
  evaluateTenderCompliance,
  generateGenericRequirementSuggestions,
} from "./compliance-engine";
import { extractRequirementsFromPbcText } from "./pbc-extractor";
import { assessTenderPbc, createPbcSourceMetadata } from "./pbc-provenance";
import { assembleTenderPackage } from "./tender-operations";

const sourceText = "El oferente deberá presentar el Certificado de Cumplimiento Tributario (CCT) vigente al momento de apertura. Este requisito obligatorio para participar en la convocatoria.";

describe("PBC provenance and documentary readiness", () => {
  it("accepts parser-backed requirements and preserves their excerpt in the report", () => {
    const extraction = extractRequirementsFromPbcText(sourceText);
    const assessment = assessTenderPbc({
      pbc_texto_crudo: sourceText,
      pbc_requisitos_extraidos: {
        ...extraction,
        source: createPbcSourceMetadata(sourceText, "2026-09-25T12:00:00.000Z"),
      },
    });

    expect(assessment.status).toBe("ANALYZED");
    if (assessment.status !== "ANALYZED") throw new Error("Expected analyzed PBC");
    expect(assessment.requirements.length).toBeGreaterThan(0);
    expect(assessment.sourceSha256).toMatch(/^[a-f0-9]{64}$/);

    const report = evaluateTenderCompliance("tender-1", assessment.requirements, [], undefined, "EXTRACTED_FROM_PBC");
    expect(report.evaluations[0].sourceEvidence?.provenance).toBe("PBC_TEXT_PARSER");
    expect(report.evaluations[0].sourceEvidence?.snippet).toContain("Certificado de Cumplimiento Tributario");
  });

  it("fails closed when the supplied PBC text no longer matches the extraction fingerprint", () => {
    const extraction = extractRequirementsFromPbcText(sourceText);
    const assessment = assessTenderPbc({
      pbc_texto_crudo: `${sourceText} texto alterado`,
      pbc_requisitos_extraidos: {
        ...extraction,
        source: createPbcSourceMetadata(sourceText, "2026-09-25T12:00:00.000Z"),
      },
    });

    expect(assessment.status).toBe("NOT_ANALYZED");
  });

  it("keeps generic suggestions in pre-evaluation and blocks documentary readiness", () => {
    const generic = generateGenericRequirementSuggestions({ id: "tender-1", categoria: "obra" });
    const report = evaluateTenderCompliance("tender-1", generic, [], undefined, "GENERIC_REQUIREMENT_SUGGESTIONS");
    const packageDraft = assembleTenderPackage({
      tenderId: "LPN-1",
      tenderTitle: "Obra de prueba",
      buyerName: "Convocante",
      bidderName: "Empresa Demo",
      bidderRuc: "80000001-9",
      legalRepresentative: "Representante Demo",
      items: [{ itemNumber: 1, description: "Trabajo", unit: "m", quantity: 1, unitPricePyg: 100 }],
      vaultItems: [],
      complianceReport: report,
    });

    expect(report.evidenceOrigin).toBe("GENERIC_REQUIREMENT_SUGGESTIONS");
    expect(report.isEligibleToBid).toBe(false);
    expect(packageDraft.packageStatus).toBe("DRAFT_INCOMPLETE");
    expect(packageDraft.validationErrors.join(" ")).toContain("REQUISITOS GENÉRICOS");
    expect(packageDraft.validationErrors.join(" ")).toContain("READY_TO_SIGN");
  });

  it("does not treat a non-parser requirement array as a PBC extraction", () => {
    const assessment = assessTenderPbc({
      pbc_requisitos_extraidos: {
        requirements: [{ id: "generic-1", descripcion: "Sugerencia", sourceEvidence: null }],
      },
    });
    expect(assessment.status).toBe("NOT_ANALYZED");
  });
});
