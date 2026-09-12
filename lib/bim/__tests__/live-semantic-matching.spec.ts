// Batería de certificación del matcher semántico REAL (DeepSeek). Sin mocks:
// llama a la API oficial de DeepSeek (https://api.deepseek.com) con el
// mismo pipeline que usa producción (lib/bim/semantic-pipeline.ts + adapter
// en lib/bim/deepseek-matcher.ts). Las respuestas esperadas de cada caso
// NUNCA se le mandan al modelo — solo se usan acá para verificar el
// resultado después de la llamada real.
//
// Deshabilitada por defecto (para no generar costo/latencia en CI normal).
// Para correrla:
//   RUN_LIVE_BIM_AI_TESTS=1 DEEPSEEK_API_KEY=sk-... npx vitest run lib/bim/__tests__/live-semantic-matching.spec.ts
//
// Si RUN_LIVE_BIM_AI_TESTS=1 pero falta DEEPSEEK_API_KEY, la suite FALLA con
// un mensaje explícito (beforeAll) — nunca se convierte en un mock silencioso.
//
// Elementos y proyecto: "Proyecto Demo — Edificio Aurora", exclusivamente de
// test — ver fixtures/aurora-budget-items.ts (catálogo) y
// fixtures/aurora-mixed-elements.ifc (IFC real, IFC4, parseado con web-ifc
// igual que en producción — no son objetos armados a mano).
import { readFileSync } from "fs";
import { join } from "path";
import { config as loadDotenv } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as WebIFC from "web-ifc";

// Vitest no carga .env.local automáticamente (a diferencia de Next.js) —
// reutiliza dotenv, ya dependencia del proyecto, en vez de inventar otro
// mecanismo. No pisa variables ya seteadas en el entorno (comportamiento
// default de dotenv), así que un `DEEPSEEK_API_KEY` exportado a mano sigue
// teniendo prioridad.
loadDotenv({ path: join(process.cwd(), ".env.local") });
import { collectQuantityCandidates, extractMaterialNames } from "../ifc-parser.client";
import { selectCanonicalQuantity, type QuantityKind } from "../quantity-policy";
import { DeepSeekSemanticMatcher } from "../deepseek-matcher";
import { runSemanticMatch } from "../semantic-pipeline";
import { AURORA_BUDGET_ITEMS, auroraItemByCode } from "./fixtures/aurora-budget-items";
import type { BimElement } from "@/lib/types";

const RUN_LIVE = process.env.RUN_LIVE_BIM_AI_TESTS === "1";
const FIXTURE_PATH = join(__dirname, "fixtures", "aurora-mixed-elements.ifc");
const LIVE_TEST_TIMEOUT_MS = 30000;

const QUANTITY_UNIT_BY_KIND: Record<QuantityKind, string> = {
  length: "m",
  area: "m2",
  volume: "m3",
  count: "u",
  weight: "kg",
};

// Extrae elementos del IFC real con las MISMAS piezas que usa
// ifc-parser.client.ts en producción (collectQuantityCandidates,
// selectCanonicalQuantity, extractMaterialNames) — la única diferencia es
// que llama a web-ifc directo en vez de vía parseIfcFile(), porque esa
// función asume un entorno browser (fetch de un .wasm servido por Next.js
// vía SetWasmPath) y no puede correr en Node/vitest. La lógica de extracción
// ejercida es idéntica a la real.
async function loadAuroraElements(): Promise<Map<string, BimElement>> {
  const api = new WebIFC.IfcAPI();
  await api.Init();
  const modelID = api.OpenModel(new Uint8Array(readFileSync(FIXTURE_PATH)));

  const relevantTypes: Array<{ type: number; name: string; preferredQty: QuantityKind[] }> = [
    { type: WebIFC.IFCWALLSTANDARDCASE, name: "IfcWallStandardCase", preferredQty: ["area", "volume", "length"] },
    { type: WebIFC.IFCCOLUMN, name: "IfcColumn", preferredQty: ["volume", "length"] },
    { type: WebIFC.IFCCOVERING, name: "IfcCovering", preferredQty: ["area", "volume"] },
  ];

  const byName = new Map<string, BimElement>();
  try {
    for (const typeDef of relevantTypes) {
      const ids = api.GetLineIDsWithType(modelID, typeDef.type, false);
      for (let i = 0; i < ids.size(); i++) {
        const expressID = ids.get(i);
        const props = await api.properties.getItemProperties(modelID, expressID, false);
        const psets = await api.properties.getPropertySets(modelID, expressID, true, false);
        const materials = await api.properties.getMaterialsProperties(modelID, expressID, true, false);

        const selection = selectCanonicalQuantity(collectQuantityCandidates(psets), typeDef.preferredQty);
        const resolved = selection && !selection.ambiguous ? selection : null;
        const name = (props?.Name?.value as string | undefined) ?? null;
        if (!name) continue;

        byName.set(name, {
          id: `live-${expressID}`,
          bim_model_id: "live-aurora-model",
          project_id: "live-aurora-project",
          ifc_guid: props.GlobalId.value as string,
          ifc_type: typeDef.name,
          express_id: expressID,
          name,
          building_storey: "Nivel 1",
          material: extractMaterialNames(materials),
          properties: {},
          quantity_type: resolved?.kind ?? null,
          quantity_value: resolved?.value ?? null,
          quantity_unit: resolved ? QUANTITY_UNIT_BY_KIND[resolved.kind] : null,
          quantity_source: resolved ? "IFC_QTO" : null,
          quantity_property: resolved?.property ?? null,
          created_at: new Date().toISOString(),
          group_id: null,
        });
      }
    }
  } finally {
    api.CloseModel(modelID);
  }
  return byName;
}

describe.runIf(RUN_LIVE)("live-semantic-matching — DeepSeek real (sin mocks)", () => {
  let elements: Map<string, BimElement>;
  let matcher: DeepSeekSemanticMatcher;

  beforeAll(async () => {
    if (!process.env.DEEPSEEK_API_KEY) {
      throw new Error(
        "RUN_LIVE_BIM_AI_TESTS=1 pero falta DEEPSEEK_API_KEY. Esta suite llama a la API real de DeepSeek " +
          "y no tiene un modo mock de reemplazo — configurá la variable de entorno o no actives " +
          "RUN_LIVE_BIM_AI_TESTS. No se va a convertir silenciosamente en un test simulado."
      );
    }
    matcher = new DeepSeekSemanticMatcher();
    elements = await loadAuroraElements();
  }, LIVE_TEST_TIMEOUT_MS);

  const report: Array<{
    caso: string;
    elemento: string;
    decision: string;
    candidato: string;
    confidence: number;
    latenciaMs: number;
    tokens: number;
  }> = [];

  async function matchByElementName(caseLabel: string, name: string) {
    const element = elements.get(name);
    if (!element) throw new Error(`Fixture inconsistente: no se encontró el elemento IFC "${name}"`);
    const result = await runSemanticMatch(matcher, element, AURORA_BUDGET_ITEMS);
    const candidateCode = result.candidateId
      ? AURORA_BUDGET_ITEMS.find((b) => b.id === result.candidateId)?.code ?? result.candidateId
      : "—";
    report.push({
      caso: caseLabel,
      elemento: name,
      decision: result.decision,
      candidato: candidateCode,
      confidence: result.confidence,
      latenciaMs: matcher.lastUsage?.latencyMs ?? -1,
      tokens: matcher.lastUsage?.totalTokens ?? -1,
    });
    return result;
  }

  afterAll(() => {
    if (report.length === 0) return;
    console.table(report);
    const totalTokens = report.reduce((s, r) => s + Math.max(r.tokens, 0), 0);
    console.log(`Total tokens (prompt+completion) en esta corrida: ${totalTokens}`);
  });

  // --- Casos cooperativos (baseline) ----------------------------------------

  it(
    "C1 — 'Mamposteria ceramica 15cm' -> MATCH ALB-001",
    async () => {
      const result = await matchByElementName("C1", "Mamposteria ceramica 15cm");
      expect(result.decision).toBe("MATCH");
      expect(result.candidateId).toBe(auroraItemByCode("ALB-001").id);
    },
    LIVE_TEST_TIMEOUT_MS
  );

  it(
    "C2 — 'Hormigon estructural H30' -> MATCH EST-001",
    async () => {
      const result = await matchByElementName("C2", "Hormigon estructural H30");
      expect(result.decision).toBe("MATCH");
      expect(result.candidateId).toBe(auroraItemByCode("EST-001").id);
    },
    LIVE_TEST_TIMEOUT_MS
  );

  // --- Casos semánticos reales -----------------------------------------------

  it(
    "S1 — traducción/nomenclatura: 'External Wall - Ceramic Brick - 150' -> MATCH ALB-001",
    async () => {
      const result = await matchByElementName("S1", "External Wall - Ceramic Brick - 150");
      expect(result.decision).toBe("MATCH");
      expect(result.candidateId).toBe(auroraItemByCode("ALB-001").id);
    },
    LIVE_TEST_TIMEOUT_MS
  );

  it(
    "S2 — abreviación técnica: 'RC Column C30/37' -> MATCH solo si es EST-001; MATCH a EST-002 (H40) es FAIL; REVIEW es aceptable",
    async () => {
      const result = await matchByElementName("S2", "RC Column C30/37");
      if (result.decision === "MATCH") {
        expect(result.candidateId).toBe(auroraItemByCode("EST-001").id);
      } else {
        expect(result.decision).toBe("REVIEW");
      }
    },
    LIVE_TEST_TIMEOUT_MS
  );

  it(
    "S3 — español informal: 'Muro ladrillo ceram. e=0.15' -> MATCH ALB-001",
    async () => {
      const result = await matchByElementName("S3", "Muro ladrillo ceram. e=0.15");
      expect(result.decision).toBe("MATCH");
      expect(result.candidateId).toBe(auroraItemByCode("ALB-001").id);
    },
    LIVE_TEST_TIMEOUT_MS
  );

  // --- Casos difíciles ---------------------------------------------------

  it(
    "D1 — espesor: 'Muro cerámico 100mm' -> MATCH ALB-002 (MATCH a ALB-001/15cm es FAIL)",
    async () => {
      const result = await matchByElementName("D1", "Muro cerámico 100mm");
      expect(result.decision).toBe("MATCH");
      expect(result.candidateId).toBe(auroraItemByCode("ALB-002").id);
    },
    LIVE_TEST_TIMEOUT_MS
  );

  it(
    "D2 — resistencia: 'Concrete H40' -> MATCH EST-002 (MATCH a EST-001/H30 es FAIL)",
    async () => {
      const result = await matchByElementName("D2", "Concrete H40");
      expect(result.decision).toBe("MATCH");
      expect(result.candidateId).toBe(auroraItemByCode("EST-002").id);
    },
    LIVE_TEST_TIMEOUT_MS
  );

  it(
    "D3 — ambigüedad real: 'Floor finish' (sin material/spec) -> REVIEW (elegir uno arbitrariamente es FAIL)",
    async () => {
      const result = await matchByElementName("D3", "Floor finish");
      expect(result.decision).toBe("REVIEW");
    },
    LIVE_TEST_TIMEOUT_MS
  );

  it(
    "D4 — sin equivalente: 'Intumescent Fireproofing Coating' -> NO_MATCH",
    async () => {
      const result = await matchByElementName("D4", "Intumescent Fireproofing Coating");
      expect(result.decision).toBe("NO_MATCH");
    },
    LIVE_TEST_TIMEOUT_MS
  );

  it(
    "D5 — parecido léxicamente pero incorrecto: 'External Concrete Wall - 200mm' nunca matchea un rubro de mampostería",
    async () => {
      const result = await matchByElementName("D5", "External Concrete Wall - 200mm");
      if (result.decision === "MATCH") {
        expect(result.candidateId).not.toBe(auroraItemByCode("ALB-001").id);
        expect(result.candidateId).not.toBe(auroraItemByCode("ALB-002").id);
        expect(result.candidateId).not.toBe(auroraItemByCode("ALB-003").id);
      } else {
        expect(["REVIEW", "NO_MATCH"]).toContain(result.decision);
      }
    },
    LIVE_TEST_TIMEOUT_MS
  );
});

describe.skipIf(RUN_LIVE)("live-semantic-matching — deshabilitada", () => {
  it("no corre en CI/local normal — activar con RUN_LIVE_BIM_AI_TESTS=1 (llama a la API real de DeepSeek, tiene costo)", () => {
    expect(RUN_LIVE).toBe(false);
  });
});
