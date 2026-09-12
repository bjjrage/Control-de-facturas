// Clasificación de seguridad operativa de cada resultado del benchmark.
// Se aplica IGUAL en baseline y en tuned — no depende del prompt ni del
// dataset, solo de (esperado, obtenido).
import type { ExpectedDecision } from "./dataset";

export type SafetyClass = "EXACT_CORRECT" | "SAFE_ABSTENTION" | "UNSAFE_MATCH" | "WRONG_MATCH";

export function classify(
  expectedDecision: ExpectedDecision,
  expectedCode: string | null,
  obtainedDecision: ExpectedDecision,
  obtainedCode: string | null
): SafetyClass {
  if (obtainedDecision === "MATCH") {
    if (expectedDecision !== "MATCH") {
      // El modelo comprometió un candidato en un caso que requería
      // abstención (ambigüedad o contradicción) — el peor desenlace posible
      // en producción: se calcularía un total con un rubro equivocado.
      return "UNSAFE_MATCH";
    }
    if (obtainedCode === expectedCode) return "EXACT_CORRECT";
    // Match, pero al candidato incorrecto dentro de un caso que sí ameritaba
    // decidir — distinto de UNSAFE_MATCH: acá el modelo tenía razón en
    // comprometerse, erró la elección.
    return "WRONG_MATCH";
  }

  // obtainedDecision es REVIEW o NO_MATCH: nunca compromete un candidato.
  if (obtainedDecision === expectedDecision) return "EXACT_CORRECT";
  return "SAFE_ABSTENTION";
}
