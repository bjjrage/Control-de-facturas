// Dataset de stress test para el matcher semántico (60 elementos), pensado
// para parecerse a un proyecto real en vez de casos unitarios aislados.
// Reutiliza el catálogo económico "Proyecto Demo — Edificio Aurora"
// (aurora-budget-items.ts). NUNCA toca Supabase — son objetos BimElement en
// memoria.
//
// Las expectativas (`expectedDecision`/`expectedCandidateCode`) viven
// SEPARADAS del objeto que se le manda a DeepSeek (ver
// lib/bim/semantic-pipeline.ts: toSemanticMatchInput solo serializa `bim` +
// `candidates`, nunca este archivo) — el modelo nunca ve la respuesta
// esperada.
import type { BimElement } from "@/lib/types";

export type StressCaseCategory = "cooperative" | "semantic" | "ambiguous" | "adversarial";

export interface StressCase {
  id: string;
  category: StressCaseCategory;
  element: BimElement;
  expectedDecision: "MATCH" | "REVIEW" | "NO_MATCH";
  /** Solo cuando expectedDecision === "MATCH". */
  expectedCandidateCode?: string;
  /** Casos que deberían converger al mismo rubro — para medir consistencia. */
  consistencyGroup?: string;
}

let seq = 0;
function el(overrides: Partial<BimElement> & Pick<BimElement, "name">): BimElement {
  seq++;
  return {
    id: `stress-el-${seq}`,
    bim_model_id: "stress-model",
    project_id: "stress-project",
    ifc_guid: `STRESS-GUID-${seq}`,
    ifc_type: "IfcWall",
    express_id: seq,
    building_storey: "Nivel 1",
    material: null,
    properties: {},
    quantity_type: null,
    quantity_value: null,
    quantity_unit: null,
    quantity_source: null,
    quantity_property: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function wallM2(name: string, value: number, material: string | null = null): BimElement {
  return el({
    name,
    ifc_type: "IfcWallStandardCase",
    material,
    quantity_type: "area",
    quantity_value: value,
    quantity_unit: "m2",
    quantity_source: "IFC_QTO",
    quantity_property: "BaseQuantities.NetSideArea",
  });
}

function concreteM3(name: string, value: number, material: string | null = "Concrete"): BimElement {
  return el({
    name,
    ifc_type: "IfcColumn",
    material,
    quantity_type: "volume",
    quantity_value: value,
    quantity_unit: "m3",
    quantity_source: "IFC_QTO",
    quantity_property: "BaseQuantities.NetVolume",
  });
}

function steelKg(name: string, value: number): BimElement {
  return el({
    name,
    ifc_type: "IfcReinforcingBar",
    material: "Steel CA-50",
    quantity_type: "weight",
    quantity_value: value,
    quantity_unit: "kg",
    quantity_source: "IFC_QTO",
    quantity_property: "BaseQuantities.Weight",
  });
}

function coveringM2(name: string, value: number, material: string | null = null): BimElement {
  return el({
    name,
    ifc_type: "IfcCovering",
    material,
    quantity_type: "area",
    quantity_value: value,
    quantity_unit: "m2",
    quantity_source: "IFC_QTO",
    quantity_property: "BaseQuantities.NetArea",
  });
}

function generic(name: string, overrides: Partial<BimElement> = {}): BimElement {
  return el({ name, ifc_type: "IfcBuildingElementProxy", ...overrides });
}

// ---------------------------------------------------------------------------
// 20 casos cooperativos — nombres cercanos al catálogo, validan baseline.
// ---------------------------------------------------------------------------
const cooperative: StressCase[] = [
  { id: "COOP-01", category: "cooperative", element: wallM2("Mampostería cerámica 15cm", 22), expectedDecision: "MATCH", expectedCandidateCode: "ALB-001" },
  { id: "COOP-02", category: "cooperative", element: wallM2("Mampostería cerámica 10cm", 18), expectedDecision: "MATCH", expectedCandidateCode: "ALB-002" },
  { id: "COOP-03", category: "cooperative", element: wallM2("Mampostería de ladrillo común 15 cm", 16), expectedDecision: "MATCH", expectedCandidateCode: "ALB-003" },
  { id: "COOP-04", category: "cooperative", element: concreteM3("Hormigón H30", 8.4), expectedDecision: "MATCH", expectedCandidateCode: "EST-001" },
  { id: "COOP-05", category: "cooperative", element: concreteM3("Hormigón estructural H30", 6.1), expectedDecision: "MATCH", expectedCandidateCode: "EST-001" },
  { id: "COOP-06", category: "cooperative", element: concreteM3("Hormigón H40", 5.9), expectedDecision: "MATCH", expectedCandidateCode: "EST-002" },
  { id: "COOP-07", category: "cooperative", element: concreteM3("Hormigón estructural H40", 7.2), expectedDecision: "MATCH", expectedCandidateCode: "EST-002" },
  { id: "COOP-08", category: "cooperative", element: steelKg("Acero CA-50", 1240), expectedDecision: "MATCH", expectedCandidateCode: "EST-003" },
  { id: "COOP-09", category: "cooperative", element: coveringM2("Revoque interior", 40), expectedDecision: "MATCH", expectedCandidateCode: "TER-001" },
  { id: "COOP-10", category: "cooperative", element: coveringM2("Pintura interior látex", 40), expectedDecision: "MATCH", expectedCandidateCode: "TER-002" },
  { id: "COOP-11", category: "cooperative", element: coveringM2("Piso porcelanato 60x60", 55), expectedDecision: "MATCH", expectedCandidateCode: "PIS-001" },
  { id: "COOP-12", category: "cooperative", element: coveringM2("Piso porcelanato 80x80", 30), expectedDecision: "MATCH", expectedCandidateCode: "PIS-002" },
  { id: "COOP-13", category: "cooperative", element: coveringM2("Piso cerámico", 25), expectedDecision: "MATCH", expectedCandidateCode: "PIS-003" },
  { id: "COOP-14", category: "cooperative", element: wallM2("Mampostería cerámica 15 cm", 19), expectedDecision: "MATCH", expectedCandidateCode: "ALB-001" },
  { id: "COOP-15", category: "cooperative", element: wallM2("Mampostería cerámica 10 cm", 12), expectedDecision: "MATCH", expectedCandidateCode: "ALB-002" },
  { id: "COOP-16", category: "cooperative", element: concreteM3("Hormigón H30", 3.3), expectedDecision: "MATCH", expectedCandidateCode: "EST-001" },
  { id: "COOP-17", category: "cooperative", element: concreteM3("Hormigón H40", 4.5), expectedDecision: "MATCH", expectedCandidateCode: "EST-002" },
  { id: "COOP-18", category: "cooperative", element: coveringM2("Pintura interior látex", 60), expectedDecision: "MATCH", expectedCandidateCode: "TER-002" },
  { id: "COOP-19", category: "cooperative", element: coveringM2("Piso porcelanato 60x60", 40), expectedDecision: "MATCH", expectedCandidateCode: "PIS-001" },
  { id: "COOP-20", category: "cooperative", element: steelKg("Acero CA-50", 860), expectedDecision: "MATCH", expectedCandidateCode: "EST-003" },
];

// ---------------------------------------------------------------------------
// 20 casos semánticos — 10 sueltos (nomenclatura/idioma distinto) + 10 en un
// mismo grupo de consistencia (todos deberían converger a ALB-001).
// ---------------------------------------------------------------------------
const semanticLoose: StressCase[] = [
  { id: "SEM-01", category: "semantic", element: wallM2("External Wall - Ceramic Brick - 150", 88.2, "Ceramic Brick"), expectedDecision: "MATCH", expectedCandidateCode: "ALB-001" },
  { id: "SEM-02", category: "semantic", element: wallM2("Interior Partition Ceramic 100", 24, "Ceramic"), expectedDecision: "MATCH", expectedCandidateCode: "ALB-002" },
  { id: "SEM-03", category: "semantic", element: concreteM3("RC Beam C30/37", 3.2, "Concrete C30/37") /* IfcBeam sería más preciso */, expectedDecision: "MATCH", expectedCandidateCode: "EST-001" },
  { id: "SEM-04", category: "semantic", element: concreteM3("Reinforced Concrete Column C30", 6.8, "Concrete C30"), expectedDecision: "MATCH", expectedCandidateCode: "EST-001" },
  { id: "SEM-05", category: "semantic", element: coveringM2("Latex Interior Wall Finish", 50), expectedDecision: "MATCH", expectedCandidateCode: "TER-002" },
  { id: "SEM-06", category: "semantic", element: coveringM2("Porcelain Floor Tile 600x600", 45), expectedDecision: "MATCH", expectedCandidateCode: "PIS-001" },
  { id: "SEM-07", category: "semantic", element: wallM2("Ceramic Masonry e=0.15", 30, "Ceramic"), expectedDecision: "MATCH", expectedCandidateCode: "ALB-001" },
  { id: "SEM-08", category: "semantic", element: concreteM3("H° estructural 30 MPa", 4.1, "Hormigón"), expectedDecision: "MATCH", expectedCandidateCode: "EST-001" },
  { id: "SEM-09", category: "semantic", element: wallM2("Ladrillo cerámico hueco esp. 15", 27, "Ladrillo cerámico hueco"), expectedDecision: "MATCH", expectedCandidateCode: "ALB-001" },
  { id: "SEM-10", category: "semantic", element: coveringM2("Wall finish latex paint", 33), expectedDecision: "MATCH", expectedCandidateCode: "TER-002" },
];

const wallGroup: StressCase[] = [
  { id: "GRP-01", element: wallM2("External Ceramic Wall 150 - A", 18, "Ceramic") },
  { id: "GRP-02", element: wallM2("External Ceramic Wall 150 - B", 23, "Ceramic") },
  { id: "GRP-03", element: wallM2("Muro cerámico e=0.15 - C", 14, "Cerámico") },
  { id: "GRP-04", element: wallM2("Ceramic Brick Wall 150 - D", 19, "Ceramic Brick") },
  { id: "GRP-05", element: wallM2("Mampostería cerámica 15cm - E", 21, "Cerámico") },
  { id: "GRP-06", element: wallM2("Wall - Ceramic - 150mm - F", 17, "Ceramic") },
  { id: "GRP-07", element: wallM2("Ceramic masonry wall 15 cm - G", 25, "Ceramic") },
  { id: "GRP-08", element: wallM2("Muro de mampostería cerámica espesor 15 - H", 20, "Cerámico") },
  { id: "GRP-09", element: wallM2("15cm Ceramic Block Wall - I", 16, "Ceramic Block") },
  { id: "GRP-10", element: wallM2("Ext. Wall Ceramic 150mm - J", 22, "Ceramic") },
].map(
  (c): StressCase => ({
    ...c,
    category: "semantic",
    expectedDecision: "MATCH",
    expectedCandidateCode: "ALB-001",
    consistencyGroup: "WALL-GROUP-ALB001",
  })
);

const semantic: StressCase[] = [...semanticLoose, ...wallGroup];

// ---------------------------------------------------------------------------
// 10 casos ambiguos — información insuficiente, se prefiere REVIEW.
// ---------------------------------------------------------------------------
const ambiguous: StressCase[] = [
  { id: "AMB-01", category: "ambiguous", element: coveringM2("Floor finish", 60), expectedDecision: "REVIEW" },
  { id: "AMB-02", category: "ambiguous", element: coveringM2("Wall finish", 40), expectedDecision: "REVIEW" },
  { id: "AMB-03", category: "ambiguous", element: concreteM3("Concrete", 5, null), expectedDecision: "REVIEW" },
  { id: "AMB-04", category: "ambiguous", element: wallM2("Masonry", 20, null), expectedDecision: "REVIEW" },
  { id: "AMB-05", category: "ambiguous", element: coveringM2("Interior coating", 35), expectedDecision: "REVIEW" },
  { id: "AMB-06", category: "ambiguous", element: generic("Structural element"), expectedDecision: "REVIEW" },
  { id: "AMB-07", category: "ambiguous", element: coveringM2("Piso", 50), expectedDecision: "REVIEW" },
  { id: "AMB-08", category: "ambiguous", element: coveringM2("Revestimiento", 28), expectedDecision: "REVIEW" },
  { id: "AMB-09", category: "ambiguous", element: coveringM2("Acabado interior", 33), expectedDecision: "REVIEW" },
  { id: "AMB-10", category: "ambiguous", element: concreteM3("Elemento de hormigón", 4.4, "Concrete"), expectedDecision: "REVIEW" },
];

// ---------------------------------------------------------------------------
// 10 casos adversariales — diseñados para producir falsos positivos si el
// sistema es complaciente. Un MATCH incorrecto acá es lo más grave que puede
// pasar (ver criterio de éxito: false positives pesan más que REVIEW de más).
// ---------------------------------------------------------------------------
const adversarial: StressCase[] = [
  // Espesor: 100mm no debe caer en ALB-001 (15cm).
  { id: "ADV-01", category: "adversarial", element: wallM2("Ceramic Wall 100mm thick", 30, "Ceramic"), expectedDecision: "MATCH", expectedCandidateCode: "ALB-002" },
  // Resistencia: H40 no debe caer en H30.
  { id: "ADV-02", category: "adversarial", element: concreteM3("Concrete H40", 5.5, "Concrete"), expectedDecision: "MATCH", expectedCandidateCode: "EST-002" },
  // Material parecido por texto ("wall") pero incorrecto: hormigón no es mampostería.
  { id: "ADV-03", category: "adversarial", element: wallM2("External Concrete Wall", 40, "Concrete"), expectedDecision: "NO_MATCH" },
  // Piso ambiguo sin dimensión — no elegir 60x60 vs 80x80 arbitrariamente.
  { id: "ADV-04", category: "adversarial", element: coveringM2("Porcelain finish", 70, "Porcelain"), expectedDecision: "REVIEW" },
  // Sin rubro equivalente.
  { id: "ADV-05", category: "adversarial", element: coveringM2("Intumescent Fireproofing Coating", 310), expectedDecision: "NO_MATCH" },
  // Unidad "compatible por casualidad": el elemento (revestimiento cerámico)
  // quedó extraído en m³ y el catálogo SÍ tiene ítems en m³ (el hormigón
  // estructural) — el filtro técnico solo mira unidad/espesor/resistencia,
  // no concepto, así que EST-001/EST-002 SOBREVIVEN el filtro determinista
  // (ver stress-dataset-guardrail.spec.ts). La prueba real de que esto no
  // produce un falso positivo (revestimiento -> "hormigón estructural") queda
  // 100% en manos del matcher semántico.
  { id: "ADV-06", category: "adversarial", element: el({ name: "Revestimiento cerámico", ifc_type: "IfcCovering", material: "Ceramic", quantity_type: "volume", quantity_value: 2.1, quantity_unit: "m3", quantity_source: "IFC_QTO", quantity_property: "BaseQuantities.NetVolume" }), expectedDecision: "NO_MATCH" },
  // Resistencia intermedia sin candidato exacto (H35 no es ni H30 ni H40) —
  // el filtro determinista de resistencia sí vacía el pool de hormigón acá
  // (ver stress-dataset-guardrail.spec.ts), a diferencia de ADV-06.
  { id: "ADV-07", category: "adversarial", element: concreteM3("Hormigón H35", 4.8, "Concrete"), expectedDecision: "NO_MATCH" },
  // Espesor intermedio sin candidato exacto (12cm no es ni 10 ni 15) — el
  // filtro determinista excluye ALB-001/002, pero TER-*/PIS-* (sin espesor
  // detectable en su texto) siguen en el pool: la prueba real de que
  // DeepSeek no le asigna un ítem de piso/pintura a un muro es semántica.
  { id: "ADV-08", category: "adversarial", element: wallM2("Muro de 12cm", 22, "Cerámico"), expectedDecision: "NO_MATCH" },
  // Material distinto aunque comparta "wall": bloque de hormigón no es mampostería cerámica.
  { id: "ADV-09", category: "adversarial", element: wallM2("Concrete Block Wall", 26, "Concrete Block"), expectedDecision: "NO_MATCH" },
  // Producto distinto aunque ambos sean "pintura": esmalte no es lo mismo que látex interior.
  { id: "ADV-10", category: "adversarial", element: coveringM2("Interior Paint - Enamel", 38, "Enamel paint"), expectedDecision: "NO_MATCH" },
];

export const STRESS_DATASET: StressCase[] = [...cooperative, ...semantic, ...ambiguous, ...adversarial];

if (STRESS_DATASET.length !== 60) {
  throw new Error(`aurora-stress-dataset debería tener 60 casos, tiene ${STRESS_DATASET.length}`);
}
