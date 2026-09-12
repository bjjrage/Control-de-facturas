// Interfaz desacoplada del matcher semántico. El adapter concreto (hoy
// DeepSeekSemanticMatcher, en deepseek-matcher.ts) puede cambiarse sin tocar
// el resto del pipeline BIM — nada fuera de esta carpeta debe importar el
// adapter directamente, solo este contrato.
//
// El filtro determinista (matching.ts: isTechnicallyCompatible) sigue siendo
// el guardrail técnico que descarta candidatos imposibles ANTES de llegar
// acá. Este matcher decide la equivalencia SEMÁNTICA entre lo que sobrevive
// a ese filtro — nunca al revés, y el fuzzy/token scorer local nunca es la
// autoridad final, solo señal de retrieval para acotar cuántos candidatos se
// le mandan al modelo.
export type SemanticMatchDecision = "MATCH" | "REVIEW" | "NO_MATCH";

export interface SemanticMatchBimInput {
  ifcType: string;
  name: string | null;
  material: string | null;
  storey: string | null;
  quantity: { type: string; value: number; unit: string } | null;
  properties: Record<string, unknown>;
}

export interface SemanticMatchCandidate {
  id: string;
  code: string;
  description: string;
  unit: string | null;
  unitPrice: number | null;
}

export interface SemanticMatchInput {
  bim: SemanticMatchBimInput;
  candidates: SemanticMatchCandidate[];
}

export interface SemanticMatchResult {
  decision: SemanticMatchDecision;
  /** Solo no-null cuando decision === "MATCH", y siempre uno de los IDs de `candidates`. */
  candidateId: string | null;
  /** [0, 1]. No es un precio ni una probabilidad calibrada — es la confianza que reporta el modelo. */
  confidence: number;
  reason: string;
  warnings: string[];
}

export interface SemanticMatcher {
  match(input: SemanticMatchInput): Promise<SemanticMatchResult>;
}
