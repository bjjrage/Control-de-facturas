// Golden dataset ADVERSARIAL de 150-200 casos contra el matcher semántico
// DeepSeek actual (lib/bim/deepseek-matcher.ts), vía el pipeline real
// (lib/bim/semantic-pipeline.ts::runSemanticMatch). NO se le manda la
// respuesta esperada al modelo — solo se usa acá para puntuar después.
//
// Categorías cubiertas (ver handoff): typos, es/en/pt, H20-H40, C25/30-C35/45,
// espesores 10-20cm, materiales parecidos, distractores, properties
// faltantes, contradicciones name/properties, REVIEW, NO_MATCH, unidades
// incompatibles, consistency groups (misma variante semántica -> mismo
// candidato en todos sus casos).
//
// IMPORTANTE: este dataset NO modifica el prompt, el modelo, el adapter, la
// UI, el viewer, el grouping, el presupuesto, migraciones, Supabase, GitHub
// Actions ni Playwright. Es un artefacto de medición standalone.

export type ExpectedDecision = "MATCH" | "REVIEW" | "NO_MATCH";

export interface BenchCase {
  id: string;
  category: string;
  group?: string;
  name: string;
  material?: string | null;
  ifcType: string;
  quantityUnit: string | null;
  quantityValue: number;
  properties?: Record<string, unknown>;
  expectedDecision: ExpectedDecision;
  expectedCode?: string;
  note?: string;
}

let seq = 0;
function mkCase(partial: Omit<BenchCase, "id"> & { idHint: string }): BenchCase {
  seq += 1;
  const { idHint, ...rest } = partial;
  return { id: `${String(seq).padStart(3, "0")}-${idHint}`, ...rest };
}

const cases: BenchCase[] = [];

// ===========================================================================
// A. Baseline — nombre canónico en español, un caso por rubro del catálogo
// ===========================================================================
const BASELINE: Array<{ code: string; name: string; unit: string; qty: number; ifcType: string; group?: string }> = [
  { code: "HOR-H20", name: "Hormigón estructural H20", unit: "m3", qty: 12, ifcType: "IfcColumn" },
  { code: "HOR-H25", name: "Hormigón estructural H25", unit: "m3", qty: 12, ifcType: "IfcColumn" },
  { code: "HOR-H30", name: "Hormigón estructural H30", unit: "m3", qty: 12, ifcType: "IfcColumn", group: "g-h30" },
  { code: "HOR-H35", name: "Hormigón estructural H35", unit: "m3", qty: 12, ifcType: "IfcColumn" },
  { code: "HOR-H40", name: "Hormigón estructural H40", unit: "m3", qty: 12, ifcType: "IfcColumn" },
  { code: "HOR-POBRE", name: "Hormigón pobre de limpieza H15", unit: "m3", qty: 4, ifcType: "IfcSlab" },
  { code: "HOR-C2530", name: "Hormigón C25/30", unit: "m3", qty: 12, ifcType: "IfcColumn" },
  { code: "HOR-C3037", name: "Hormigón C30/37", unit: "m3", qty: 12, ifcType: "IfcColumn" },
  { code: "HOR-C3545", name: "Hormigón C35/45", unit: "m3", qty: 12, ifcType: "IfcColumn" },
  { code: "ACE-CA50", name: "Acero CA-50", unit: "kg", qty: 850, ifcType: "IfcReinforcingBar", group: "g-ca50" },
  { code: "ACE-CA60", name: "Acero CA-60", unit: "kg", qty: 850, ifcType: "IfcReinforcingBar" },
  { code: "MAM-CER-10", name: "Mampostería cerámica 10 cm", unit: "m2", qty: 40, ifcType: "IfcWallStandardCase" },
  { code: "MAM-CER-12", name: "Mampostería cerámica 12 cm", unit: "m2", qty: 40, ifcType: "IfcWallStandardCase" },
  { code: "MAM-CER-15", name: "Mampostería cerámica 15 cm", unit: "m2", qty: 40, ifcType: "IfcWallStandardCase", group: "g-cer15" },
  { code: "MAM-CER-18", name: "Mampostería cerámica 18 cm", unit: "m2", qty: 40, ifcType: "IfcWallStandardCase" },
  { code: "MAM-CER-20", name: "Mampostería cerámica 20 cm", unit: "m2", qty: 40, ifcType: "IfcWallStandardCase" },
  { code: "MAM-LAD-15", name: "Mampostería de ladrillo común 15 cm", unit: "m2", qty: 30, ifcType: "IfcWallStandardCase" },
  { code: "MAM-BLQ-15", name: "Mampostería de bloque hueco de hormigón 15 cm", unit: "m2", qty: 30, ifcType: "IfcWallStandardCase" },
  { code: "MAM-DOBLE-25", name: "Mampostería doble cerámica con cámara de aire 25 cm", unit: "m2", qty: 20, ifcType: "IfcWallStandardCase" },
  { code: "REV-INT", name: "Revoque interior a la cal", unit: "m2", qty: 80, ifcType: "IfcCovering", group: "g-revint" },
  { code: "REV-EXT", name: "Revoque exterior impermeable", unit: "m2", qty: 60, ifcType: "IfcCovering" },
  { code: "PIN-LATEX-INT", name: "Pintura interior látex", unit: "m2", qty: 80, ifcType: "IfcCovering" },
  { code: "PIN-ESMALTE-EXT", name: "Pintura esmalte sintético para exterior", unit: "m2", qty: 60, ifcType: "IfcCovering" },
  { code: "PIS-PORC60", name: "Piso porcelanato 60x60", unit: "m2", qty: 50, ifcType: "IfcCovering", group: "g-porc60" },
  { code: "PIS-PORC80", name: "Piso porcelanato 80x80", unit: "m2", qty: 50, ifcType: "IfcCovering" },
  { code: "PIS-CERAM", name: "Piso cerámico esmaltado", unit: "m2", qty: 30, ifcType: "IfcCovering", group: "g-cerampiso" },
  { code: "PIS-VINIL", name: "Piso vinílico símil madera", unit: "m2", qty: 30, ifcType: "IfcCovering" },
  { code: "IMP-MEMB", name: "Impermeabilización con membrana asfáltica", unit: "m2", qty: 25, ifcType: "IfcCovering", group: "g-impmemb" },
  { code: "AIS-EPS-5", name: "Aislación térmica de poliestireno expandido 5 cm", unit: "m2", qty: 25, ifcType: "IfcCovering", group: "g-aiseps5" },
];

for (const b of BASELINE) {
  cases.push(
    mkCase({
      idHint: `baseline-${b.code}`,
      category: "baseline",
      group: b.group,
      name: b.name,
      ifcType: b.ifcType,
      quantityUnit: b.unit,
      quantityValue: b.qty,
      expectedDecision: "MATCH",
      expectedCode: b.code,
    })
  );
}

// ===========================================================================
// B. Typos — variante mal escrita del mismo concepto, debe seguir siendo MATCH
// ===========================================================================
const TYPOS: Array<{ code: string; name: string; unit: string; qty: number; ifcType: string; group?: string }> = [
  { code: "HOR-H20", name: "Hormigon estrutural H20", unit: "m3", qty: 12, ifcType: "IfcColumn" },
  { code: "HOR-H25", name: "Hormigon estructual H25", unit: "m3", qty: 12, ifcType: "IfcColumn" },
  { code: "HOR-H30", name: "Ormigon estructural H-30", unit: "m3", qty: 12, ifcType: "IfcColumn", group: "g-h30" },
  { code: "HOR-H35", name: "Hormigón estruictural H35", unit: "m3", qty: 12, ifcType: "IfcColumn" },
  { code: "HOR-H40", name: "Hormigon esrtuctural H40", unit: "m3", qty: 12, ifcType: "IfcColumn" },
  { code: "HOR-POBRE", name: "Hormigon pobre de limpiesa H15", unit: "m3", qty: 4, ifcType: "IfcSlab" },
  { code: "ACE-CA50", name: "Asero CA-50", unit: "kg", qty: 850, ifcType: "IfcReinforcingBar", group: "g-ca50" },
  { code: "ACE-CA60", name: "Acero CA60", unit: "kg", qty: 850, ifcType: "IfcReinforcingBar" },
  { code: "MAM-CER-10", name: "Mamposteria seramica 10 cm", unit: "m2", qty: 40, ifcType: "IfcWallStandardCase" },
  { code: "MAM-CER-12", name: "Mamposteria ceramica 12cm", unit: "m2", qty: 40, ifcType: "IfcWallStandardCase" },
  { code: "MAM-CER-15", name: "Mampostería ceramica 15 cnm", unit: "m2", qty: 40, ifcType: "IfcWallStandardCase", group: "g-cer15" },
  { code: "MAM-CER-18", name: "Mamposteria ceramica 18 c m", unit: "m2", qty: 40, ifcType: "IfcWallStandardCase" },
  { code: "MAM-CER-20", name: "Mampsoteria ceramica 20 cm", unit: "m2", qty: 40, ifcType: "IfcWallStandardCase" },
  { code: "REV-INT", name: "Revoke interior a la kal", unit: "m2", qty: 80, ifcType: "IfcCovering", group: "g-revint" },
  { code: "REV-EXT", name: "Revoque esterior impermeable", unit: "m2", qty: 60, ifcType: "IfcCovering" },
  { code: "PIN-LATEX-INT", name: "Pintura interior latex", unit: "m2", qty: 80, ifcType: "IfcCovering" },
  { code: "PIS-PORC60", name: "Piso porcelanatto 60x60", unit: "m2", qty: 50, ifcType: "IfcCovering", group: "g-porc60" },
  { code: "PIS-PORC80", name: "Piso porcelanato 80×80", unit: "m2", qty: 50, ifcType: "IfcCovering" },
  { code: "PIS-CERAM", name: "Piso ceramico esmatado", unit: "m2", qty: 30, ifcType: "IfcCovering", group: "g-cerampiso" },
  { code: "PIS-VINIL", name: "Piso vinilico simil madera", unit: "m2", qty: 30, ifcType: "IfcCovering" },
];

for (const t of TYPOS) {
  cases.push(
    mkCase({
      idHint: `typo-${t.code}`,
      category: "typo",
      group: t.group,
      name: t.name,
      ifcType: t.ifcType,
      quantityUnit: t.unit,
      quantityValue: t.qty,
      expectedDecision: "MATCH",
      expectedCode: t.code,
    })
  );
}

// ===========================================================================
// C. Idioma — inglés y portugués del mismo concepto, debe seguir siendo MATCH
// ===========================================================================
const LANG: Array<{ code: string; en: string; pt: string; unit: string; qty: number; ifcType: string; group?: string }> = [
  { code: "HOR-H20", en: "Structural concrete H20", pt: "Concreto estrutural H20", unit: "m3", qty: 12, ifcType: "IfcColumn" },
  { code: "HOR-H30", en: "Structural concrete H30", pt: "Concreto estrutural H30", unit: "m3", qty: 12, ifcType: "IfcColumn", group: "g-h30" },
  { code: "HOR-H40", en: "Structural concrete H40", pt: "Concreto estrutural H40", unit: "m3", qty: 12, ifcType: "IfcColumn" },
  { code: "ACE-CA50", en: "Steel rebar CA-50", pt: "Aço CA-50", unit: "kg", qty: 850, ifcType: "IfcReinforcingBar", group: "g-ca50" },
  { code: "MAM-CER-10", en: "Ceramic brick wall 10 cm", pt: "Alvenaria cerâmica 10 cm", unit: "m2", qty: 40, ifcType: "IfcWallStandardCase" },
  { code: "MAM-CER-15", en: "Ceramic brick wall 15 cm", pt: "Alvenaria cerâmica 15 cm", unit: "m2", qty: 40, ifcType: "IfcWallStandardCase", group: "g-cer15" },
  { code: "MAM-CER-20", en: "Ceramic brick wall 20 cm", pt: "Alvenaria cerâmica 20 cm", unit: "m2", qty: 40, ifcType: "IfcWallStandardCase" },
  { code: "REV-INT", en: "Interior plaster", pt: "Reboco interno", unit: "m2", qty: 80, ifcType: "IfcCovering", group: "g-revint" },
  { code: "REV-EXT", en: "Exterior waterproof plaster", pt: "Reboco externo impermeável", unit: "m2", qty: 60, ifcType: "IfcCovering" },
  { code: "PIN-LATEX-INT", en: "Interior latex paint", pt: "Pintura látex interna", unit: "m2", qty: 80, ifcType: "IfcCovering" },
  { code: "PIS-PORC60", en: "Porcelain tile flooring 60x60", pt: "Piso porcelanato 60x60", unit: "m2", qty: 50, ifcType: "IfcCovering", group: "g-porc60" },
  { code: "PIS-CERAM", en: "Ceramic tile flooring", pt: "Piso cerâmico esmaltado", unit: "m2", qty: 30, ifcType: "IfcCovering", group: "g-cerampiso" },
  { code: "IMP-MEMB", en: "Waterproofing with asphalt membrane", pt: "Impermeabilização com manta asfáltica", unit: "m2", qty: 25, ifcType: "IfcCovering", group: "g-impmemb" },
  { code: "AIS-EPS-5", en: "Thermal insulation EPS 5cm", pt: "Isolamento térmico de poliestireno 5 cm", unit: "m2", qty: 25, ifcType: "IfcCovering", group: "g-aiseps5" },
  { code: "PIS-VINIL", en: "Vinyl flooring wood-look", pt: "Piso vinílico símile madeira", unit: "m2", qty: 30, ifcType: "IfcCovering" },
];

for (const l of LANG) {
  cases.push(
    mkCase({
      idHint: `en-${l.code}`,
      category: "lang",
      group: l.group,
      name: l.en,
      ifcType: l.ifcType,
      quantityUnit: l.unit,
      quantityValue: l.qty,
      expectedDecision: "MATCH",
      expectedCode: l.code,
    })
  );
  cases.push(
    mkCase({
      idHint: `pt-${l.code}`,
      category: "lang",
      group: l.group,
      name: l.pt,
      ifcType: l.ifcType,
      quantityUnit: l.unit,
      quantityValue: l.qty,
      expectedDecision: "MATCH",
      expectedCode: l.code,
    })
  );
}

// ===========================================================================
// D. Distractores de espesor (escalera de mampostería 10/12/15/18/20 cm)
// ===========================================================================
cases.push(
  mkCase({ idHint: "thick-100mm", category: "distractor_thickness", name: "Muro cerámico de 100 mm de espesor", ifcType: "IfcWallStandardCase", quantityUnit: "m2", quantityValue: 22, expectedDecision: "MATCH", expectedCode: "MAM-CER-10" }),
  mkCase({ idHint: "thick-120mm", category: "distractor_thickness", name: "Tabique cerámico 120mm", ifcType: "IfcWallStandardCase", quantityUnit: "m2", quantityValue: 18, expectedDecision: "MATCH", expectedCode: "MAM-CER-12" }),
  mkCase({ idHint: "thick-e15", category: "distractor_thickness", name: "Muro cerámico e=15cm", ifcType: "IfcWallStandardCase", quantityUnit: "m2", quantityValue: 30, expectedDecision: "MATCH", expectedCode: "MAM-CER-15" }),
  mkCase({ idHint: "thick-18cm", category: "distractor_thickness", name: "Pared cerámica de 18 centímetros", ifcType: "IfcWallStandardCase", quantityUnit: "m2", quantityValue: 15, expectedDecision: "MATCH", expectedCode: "MAM-CER-18" }),
  mkCase({ idHint: "thick-20cm", category: "distractor_thickness", name: "Muro cerámico grueso de 20 cm", ifcType: "IfcWallStandardCase", quantityUnit: "m2", quantityValue: 12, expectedDecision: "MATCH", expectedCode: "MAM-CER-20" }),
  mkCase({
    idHint: "thick-140mm-nearest-15",
    category: "distractor_thickness",
    name: "Muro cerámico 140mm",
    ifcType: "IfcWallStandardCase",
    quantityUnit: "m2",
    quantityValue: 10,
    expectedDecision: "MATCH",
    expectedCode: "MAM-CER-15",
    note: "140mm: a 20mm de 12cm (fuera de tolerancia 15mm) pero a 10mm de 15cm (dentro) — el candidato correcto es 15cm, no 12cm.",
  }),
  mkCase({
    idHint: "thick-165mm-tie",
    category: "distractor_thickness",
    name: "Muro cerámico 165mm",
    ifcType: "IfcWallStandardCase",
    quantityUnit: "m2",
    quantityValue: 10,
    expectedDecision: "REVIEW",
    note: "165mm equidista de 15cm y 18cm (15mm a cada lado) — ambos técnicamente compatibles, no debe elegir arbitrariamente.",
  }),
  mkCase({
    idHint: "thick-105mm-nearest-10",
    category: "distractor_thickness",
    name: "Muro cerámico 105mm",
    ifcType: "IfcWallStandardCase",
    quantityUnit: "m2",
    quantityValue: 8,
    expectedDecision: "MATCH",
    expectedCode: "MAM-CER-10",
    note: "105mm pasa el filtro para 10cm y 12cm, pero está mucho más cerca de 10cm.",
  }),
  mkCase({
    idHint: "thick-190mm-tie",
    category: "distractor_thickness",
    name: "Muro cerámico 190mm",
    ifcType: "IfcWallStandardCase",
    quantityUnit: "m2",
    quantityValue: 9,
    expectedDecision: "REVIEW",
    note: "190mm equidista de 18cm y 20cm (10mm a cada lado).",
  }),
  mkCase({
    idHint: "thick-range-ambiguous",
    category: "distractor_thickness",
    name: "Muro cerámico, espesor aproximado entre 15 y 18 cm (a confirmar en obra)",
    ifcType: "IfcWallStandardCase",
    quantityUnit: "m2",
    quantityValue: 11,
    expectedDecision: "REVIEW",
    note: "Rango explícito que cubre dos rubros distintos — no hay evidencia para elegir uno.",
  })
);

// ===========================================================================
// E. Distractores de resistencia (escalera de hormigón H20-H40)
// ===========================================================================
cases.push(
  mkCase({ idHint: "res-h20-col", category: "distractor_resistance", name: "Columna de hormigón H20", ifcType: "IfcColumn", quantityUnit: "m3", quantityValue: 3, expectedDecision: "MATCH", expectedCode: "HOR-H20" }),
  mkCase({ idHint: "res-h25-losa", category: "distractor_resistance", name: "Losa de hormigón H25", ifcType: "IfcSlab", quantityUnit: "m3", quantityValue: 6, expectedDecision: "MATCH", expectedCode: "HOR-H25" }),
  mkCase({ idHint: "res-h30-viga", category: "distractor_resistance", name: "Viga de hormigón armado H30", ifcType: "IfcBeam", quantityUnit: "m3", quantityValue: 2, expectedDecision: "MATCH", expectedCode: "HOR-H30" }),
  mkCase({ idHint: "res-h35-fund", category: "distractor_resistance", name: "Fundación de hormigón H35", ifcType: "IfcFooting", quantityUnit: "m3", quantityValue: 8, expectedDecision: "MATCH", expectedCode: "HOR-H35" }),
  mkCase({ idHint: "res-h40-pilote", category: "distractor_resistance", name: "Pilote de hormigón H40", ifcType: "IfcPile", quantityUnit: "m3", quantityValue: 5, expectedDecision: "MATCH", expectedCode: "HOR-H40" }),
  mkCase({ idHint: "res-h15-contrapiso", category: "distractor_resistance", name: "Contrapiso de hormigón pobre H15", ifcType: "IfcSlab", quantityUnit: "m3", quantityValue: 4, expectedDecision: "MATCH", expectedCode: "HOR-POBRE" }),
  mkCase({
    idHint: "res-h22-inexistente",
    category: "distractor_resistance",
    name: "Hormigón H22",
    ifcType: "IfcColumn",
    quantityUnit: "m3",
    quantityValue: 3,
    expectedDecision: "REVIEW",
    note: "H22 no existe en el catálogo (H20/H25/H30/H35/H40 son los únicos H-code); no hay evidencia para asumir equivalencia con ninguna clase C.",
  }),
  mkCase({
    idHint: "res-sin-especificar",
    category: "distractor_resistance",
    name: "Estructura de hormigón, resistencia no especificada",
    ifcType: "IfcColumn",
    quantityUnit: "m3",
    quantityValue: 4,
    expectedDecision: "REVIEW",
    note: "Sin resistencia ni clase, hay 8 candidatos de hormigón igualmente plausibles.",
  })
);

// ===========================================================================
// F. Distractores de material (familias parecidas, materiales distintos)
// ===========================================================================
cases.push(
  mkCase({ idHint: "mat-ladrillo-comun", category: "distractor_material", name: "Mampostería de ladrillo común, espesor 15 cm", ifcType: "IfcWallStandardCase", quantityUnit: "m2", quantityValue: 25, expectedDecision: "MATCH", expectedCode: "MAM-LAD-15" }),
  mkCase({ idHint: "mat-bloque-hueco", category: "distractor_material", name: "Mampostería de bloque hueco de hormigón, 15 cm", ifcType: "IfcWallStandardCase", quantityUnit: "m2", quantityValue: 25, expectedDecision: "MATCH", expectedCode: "MAM-BLQ-15" }),
  mkCase({ idHint: "mat-doble-camara", category: "distractor_material", name: "Muro doble de ladrillo cerámico con cámara de aire, 25 cm", ifcType: "IfcWallStandardCase", quantityUnit: "m2", quantityValue: 14, expectedDecision: "MATCH", expectedCode: "MAM-DOBLE-25" }),
  mkCase({ idHint: "mat-revest-piso-vs-revoque", category: "distractor_material", name: "Revestimiento cerámico de piso", ifcType: "IfcCovering", quantityUnit: "m2", quantityValue: 20, expectedDecision: "MATCH", expectedCode: "PIS-CERAM", note: "Revestimiento de PISO (no de pared) — no debe confundirse con revoque interior/exterior." }),
  mkCase({ idHint: "mat-acero-ca60-vigas", category: "distractor_material", name: "Acero de refuerzo CA-60 para vigas", ifcType: "IfcReinforcingBar", quantityUnit: "kg", quantityValue: 600, expectedDecision: "MATCH", expectedCode: "ACE-CA60" }),
  mkCase({ idHint: "mat-esmalte-fachada", category: "distractor_material", name: "Pintura esmalte sintético para fachada exterior", ifcType: "IfcCovering", quantityUnit: "m2", quantityValue: 55, expectedDecision: "MATCH", expectedCode: "PIN-ESMALTE-EXT" })
);

// ===========================================================================
// G. Properties/nombre insuficiente (genérico) — REVIEW salvo candidato único
// ===========================================================================
cases.push(
  mkCase({ idHint: "generic-muro", category: "missing_props", name: "Muro", ifcType: "IfcWallStandardCase", quantityUnit: "m2", quantityValue: 10, expectedDecision: "REVIEW" }),
  mkCase({ idHint: "generic-revoque", category: "missing_props", name: "Revoque", ifcType: "IfcCovering", quantityUnit: "m2", quantityValue: 10, expectedDecision: "REVIEW" }),
  mkCase({ idHint: "generic-piso", category: "missing_props", name: "Piso", ifcType: "IfcCovering", quantityUnit: "m2", quantityValue: 10, expectedDecision: "REVIEW" }),
  mkCase({ idHint: "generic-pintura", category: "missing_props", name: "Pintura", ifcType: "IfcCovering", quantityUnit: "m2", quantityValue: 10, expectedDecision: "REVIEW" }),
  mkCase({ idHint: "generic-hormigon", category: "missing_props", name: "Hormigón", ifcType: "IfcColumn", quantityUnit: "m3", quantityValue: 5, expectedDecision: "REVIEW" }),
  mkCase({ idHint: "generic-mamp-ceramica", category: "missing_props", name: "Mampostería cerámica", ifcType: "IfcWallStandardCase", quantityUnit: "m2", quantityValue: 10, expectedDecision: "REVIEW", note: "Sin espesor: 5 candidatos (10/12/15/18/20 cm) igualmente plausibles." }),
  mkCase({ idHint: "generic-porcelanato", category: "missing_props", name: "Piso porcelanato", ifcType: "IfcCovering", quantityUnit: "m2", quantityValue: 10, expectedDecision: "REVIEW", note: "Sin formato: PIS-PORC60 vs PIS-PORC80." }),
  mkCase({ idHint: "generic-acero", category: "missing_props", name: "Acero", ifcType: "IfcReinforcingBar", quantityUnit: "kg", quantityValue: 300, expectedDecision: "REVIEW" }),
  mkCase({
    idHint: "single-aislacion-generica",
    category: "missing_props",
    name: "Aislación térmica",
    ifcType: "IfcCovering",
    quantityUnit: "m2",
    quantityValue: 10,
    expectedDecision: "MATCH",
    expectedCode: "AIS-EPS-5",
    note: "Genérico pero solo existe UN candidato de aislación en el catálogo — no debería abstenerse sin necesidad.",
  }),
  mkCase({
    idHint: "single-membrana-generica",
    category: "missing_props",
    name: "Membrana impermeabilizante",
    ifcType: "IfcCovering",
    quantityUnit: "m2",
    quantityValue: 10,
    expectedDecision: "MATCH",
    expectedCode: "IMP-MEMB",
    note: "Genérico pero solo existe UN candidato de impermeabilización en el catálogo.",
  }),
  mkCase({ idHint: "generic-hormigon-sin-tipo", category: "missing_props", name: "Elemento de hormigón sin datos técnicos, tipo desconocido", ifcType: "IfcBuildingElementProxy", quantityUnit: "m3", quantityValue: 3, expectedDecision: "REVIEW" }),
  mkCase({ idHint: "generic-muro-15cm-sin-material", category: "missing_props", name: "Muro de material no especificado, 15 cm", ifcType: "IfcWallStandardCase", quantityUnit: "m2", quantityValue: 18, expectedDecision: "REVIEW", note: "Espesor conocido pero 3 materiales distintos comparten 15cm (cerámica/ladrillo/bloque)." })
);

// ===========================================================================
// H. Contradicciones entre name/material y properties — REVIEW
// ===========================================================================
cases.push(
  mkCase({ idHint: "contra-h30-vs-h40-prop", category: "contradiction", name: "Hormigón H30", ifcType: "IfcColumn", quantityUnit: "m3", quantityValue: 6, properties: { resistencia_caracteristica: "H40" }, expectedDecision: "REVIEW" }),
  mkCase({ idHint: "contra-15cm-vs-20cm-prop", category: "contradiction", name: "Mampostería cerámica 15 cm", ifcType: "IfcWallStandardCase", quantityUnit: "m2", quantityValue: 20, properties: { espesor_cm: 20 }, expectedDecision: "REVIEW" }),
  mkCase({ idHint: "contra-60x60-vs-80x80-prop", category: "contradiction", name: "Piso porcelanato 60x60", ifcType: "IfcCovering", quantityUnit: "m2", quantityValue: 30, properties: { formato: "80x80" }, expectedDecision: "REVIEW" }),
  mkCase({ idHint: "contra-ca50-vs-ca60-prop", category: "contradiction", name: "Acero CA-50", ifcType: "IfcReinforcingBar", quantityUnit: "kg", quantityValue: 400, properties: { grado: "CA-60" }, expectedDecision: "REVIEW" }),
  mkCase({ idHint: "contra-revoque-material-exterior", category: "contradiction", name: "Revoque interior", material: "Mortero exterior impermeable", ifcType: "IfcCovering", quantityUnit: "m2", quantityValue: 15, expectedDecision: "REVIEW" }),
  mkCase({ idHint: "contra-h20-uso-h40", category: "contradiction", name: "Hormigón H20", ifcType: "IfcColumn", quantityUnit: "m3", quantityValue: 4, properties: { uso: "estructural de alta resistencia equivalente a H40" }, expectedDecision: "REVIEW" }),
  mkCase({ idHint: "contra-10cm-nota-20cm", category: "contradiction", name: "Mampostería cerámica 10 cm", ifcType: "IfcWallStandardCase", quantityUnit: "m2", quantityValue: 12, properties: { nota_obra: "verificar in situ, podría ser 20cm" }, expectedDecision: "REVIEW" }),
  mkCase({ idHint: "contra-pintura-ubicacion", category: "contradiction", name: "Pintura interior látex", ifcType: "IfcCovering", quantityUnit: "m2", quantityValue: 22, properties: { ubicacion_real: "fachada exterior" }, expectedDecision: "REVIEW" }),
  mkCase({ idHint: "contra-ceramico-vs-porcelanato", category: "contradiction", name: "Piso cerámico", material: "Porcelanato", ifcType: "IfcCovering", quantityUnit: "m2", quantityValue: 18, expectedDecision: "REVIEW" }),
  mkCase({ idHint: "contra-c2530-vs-h40", category: "contradiction", name: "Hormigón C25/30", ifcType: "IfcColumn", quantityUnit: "m3", quantityValue: 5, properties: { resistencia_alternativa: "equivalente a H40" }, expectedDecision: "REVIEW" }),
  mkCase({ idHint: "contra-ceramico-vs-bloque-prop", category: "contradiction", name: "Muro cerámico 15 cm", ifcType: "IfcWallStandardCase", quantityUnit: "m2", quantityValue: 16, properties: { material_real: "bloque hueco de hormigón" }, expectedDecision: "REVIEW" }),
  mkCase({ idHint: "contra-ca60-material-ca50", category: "contradiction", name: "Acero CA-60", material: "CA-50", ifcType: "IfcReinforcingBar", quantityUnit: "kg", quantityValue: 350, expectedDecision: "REVIEW" }),
  mkCase({ idHint: "contra-membrana-vs-eps", category: "contradiction", name: "Impermeabilización con membrana asfáltica", ifcType: "IfcCovering", quantityUnit: "m2", quantityValue: 14, properties: { tipo_real_segun_planilla: "aislación térmica de poliestireno expandido" }, expectedDecision: "REVIEW" }),
  mkCase({ idHint: "contra-eps5-vs-eps10", category: "contradiction", name: "Aislación térmica EPS 5cm", ifcType: "IfcCovering", quantityUnit: "m2", quantityValue: 9, properties: { espesor_real_cm: 10 }, expectedDecision: "REVIEW" }),
  mkCase({ idHint: "contra-h30-norma-h40", category: "contradiction", name: "Hormigón estructural H30", ifcType: "IfcColumn", quantityUnit: "m3", quantityValue: 7, properties: { resistencia_segun_norma: "corresponde a H40" }, expectedDecision: "REVIEW" })
);

// ===========================================================================
// I. NO_MATCH — conceptos ausentes del catálogo
// ===========================================================================
const NO_MATCH_NAMES: Array<{ name: string; ifcType: string; unit: string; qty: number }> = [
  { name: "Cielorraso de yeso con perfilería metálica", ifcType: "IfcCovering", unit: "m2", qty: 40 },
  { name: "Ventana de aluminio con DVH", ifcType: "IfcWindow", unit: "u", qty: 8 },
  { name: "Ascensor eléctrico para 8 personas", ifcType: "IfcTransportElement", unit: "u", qty: 1 },
  { name: "Conducto de aire acondicionado tipo split", ifcType: "IfcFlowSegment", unit: "m", qty: 12 },
  { name: "Cubierta de chapa trapezoidal galvanizada", ifcType: "IfcRoof", unit: "m2", qty: 90 },
  { name: "Estructura metálica reticulada galvanizada", ifcType: "IfcMember", unit: "kg", qty: 1200 },
  { name: "Cerco perimetral de alambre olímpico", ifcType: "IfcFencing", unit: "m", qty: 60 },
  { name: "Baranda de acero inoxidable para escalera", ifcType: "IfcRailing", unit: "m", qty: 14 },
  { name: "Puerta placa interior de madera", ifcType: "IfcDoor", unit: "u", qty: 10 },
  { name: "Sistema de riego automático por goteo", ifcType: "IfcFlowSegment", unit: "m", qty: 100 },
  { name: "Tanque de reserva de agua de polietileno 1000L", ifcType: "IfcTank", unit: "u", qty: 2 },
  { name: "Panel solar fotovoltaico 450W", ifcType: "IfcFlowTerminal", unit: "u", qty: 20 },
  { name: "Portón corredizo automatizado", ifcType: "IfcDoor", unit: "u", qty: 1 },
  { name: "Revestimiento de piedra laja natural", ifcType: "IfcCovering", unit: "m2", qty: 25 },
  { name: "Intumescent Fireproofing Coating", ifcType: "IfcCovering", unit: "m2", qty: 30 },
];

for (const n of NO_MATCH_NAMES) {
  cases.push(
    mkCase({
      idHint: `nomatch-${n.name.slice(0, 20).replace(/[^a-zA-Z0-9]/g, "").toLowerCase()}`,
      category: "no_match",
      name: n.name,
      ifcType: n.ifcType,
      quantityUnit: n.unit,
      quantityValue: n.qty,
      expectedDecision: "NO_MATCH",
    })
  );
}

// ===========================================================================
// J. Unidades incompatibles — el filtro determinista debe vaciar el pool
// ===========================================================================
cases.push(
  mkCase({ idHint: "unit-acero-en-metros", category: "unit_incompatible", name: "Acero CA-50", ifcType: "IfcReinforcingBar", quantityUnit: "m", quantityValue: 12, expectedDecision: "NO_MATCH", note: "Acero se costea en kg, no en m." }),
  mkCase({ idHint: "unit-hormigon-en-m2", category: "unit_incompatible", name: "Hormigón estructural H30", ifcType: "IfcColumn", quantityUnit: "m2", quantityValue: 40, expectedDecision: "NO_MATCH", note: "Hormigón se costea en m3, no en m2." }),
  mkCase({ idHint: "unit-mamposteria-en-m3", category: "unit_incompatible", name: "Mampostería cerámica 15 cm", ifcType: "IfcWallStandardCase", quantityUnit: "m3", quantityValue: 6, expectedDecision: "NO_MATCH", note: "Mampostería se costea en m2, no en m3." }),
  mkCase({ idHint: "unit-piso-en-unidades", category: "unit_incompatible", name: "Piso porcelanato 60x60", ifcType: "IfcCovering", quantityUnit: "u", quantityValue: 120, expectedDecision: "NO_MATCH", note: "Piso se costea en m2, no por unidad de pieza." }),
  mkCase({ idHint: "unit-pintura-en-kg", category: "unit_incompatible", name: "Pintura interior látex", ifcType: "IfcCovering", quantityUnit: "kg", quantityValue: 30, expectedDecision: "NO_MATCH" }),
  mkCase({ idHint: "unit-membrana-en-metros", category: "unit_incompatible", name: "Impermeabilización con membrana asfáltica", ifcType: "IfcCovering", quantityUnit: "m", quantityValue: 15, expectedDecision: "NO_MATCH" }),
  mkCase({ idHint: "unit-revoque-en-m3", category: "unit_incompatible", name: "Revoque interior a la cal", ifcType: "IfcCovering", quantityUnit: "m3", quantityValue: 10, expectedDecision: "NO_MATCH" }),
  mkCase({ idHint: "unit-aislacion-en-kg", category: "unit_incompatible", name: "Aislación térmica de poliestireno expandido 5 cm", ifcType: "IfcCovering", quantityUnit: "kg", quantityValue: 8, expectedDecision: "NO_MATCH" })
);

export const BENCH_CASES: BenchCase[] = cases;
