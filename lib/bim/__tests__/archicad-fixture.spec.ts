// Certificación con un IFC REAL (no sintético) exportado por una herramienta
// BIM de uso habitual — ARCHICAD 25 (Graphisoft), esquema IFC2X3.
//
// Fuente / procedencia: archivo público de prueba del proyecto open-source
// IfcOpenShell (test data de su "opencdeserver" — un servidor CDE de
// demostración), tomado tal cual de
// IfcOpenShell/src/opencdeserver/api/app/data/documents/6dbd4d52-14db-11ee-be56-0242ac120002.ifc
// (repo https://github.com/IfcOpenShell/IfcOpenShell, licencia LGPL, datos de
// ejemplo genéricos — sin información personal real). Copiado sin
// modificaciones a lib/bim/__tests__/fixtures/archicad-ifc2x3-walls.ifc
// (20 KB, 258 líneas) — deliberadamente pequeño, no se incorporan fixtures
// pesados al repo.
//
// Contenido: 3 IfcWallStandardCase reales ("YVT-A/B/C") con geometría
// IfcExtrudedAreaSolid, material (IfcMaterialLayerSet), Pset_WallCommon, y un
// IfcElementQuantity "BaseQuantities" con Length/Height/Width en milímetros
// (LENGTHUNIT del proyecto = IfcSIUnit MILLI.METRE) y Gross/NetFootprintArea,
// Gross/NetSideArea, Gross/NetVolume ya en m²/m³ (AREAUNIT/VOLUMEUNIT
// declarados SIN prefijo — IFC no deriva área/volumen del prefijo de
// longitud, son unidades SI independientes).
//
// Esto valida contra datos reales dos cosas que el fixture sintético
// (sample-wall.ifc) no podía, porque se escribió a mano sin ese detalle:
//   1. La política de cantidad debe elegir NetSideArea y NO confundirla con
//      NetFootprintArea (ambas matchean un patrón ingenuo "Net*Area").
//   2. La conversión de unidades de longitud debe leer el prefijo MILLI real
//      del proyecto en vez de asumir metros.
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import * as WebIFC from "web-ifc";
import { collectQuantityCandidates, extractMaterialNames } from "../ifc-parser.client";
import { selectCanonicalQuantity } from "../quantity-policy";
import { readProjectUnitScales, scaleForKind } from "../unit-conversion";
import { aggregateElementsForBudgetItem, unitsCompatibleForCosting } from "../matching";
import { calcLineSubtotal } from "@/lib/format";
import type { BimElement, BudgetItem } from "@/lib/types";

const FIXTURE_PATH = join(__dirname, "fixtures", "archicad-ifc2x3-walls.ifc");

async function openFixture() {
  const api = new WebIFC.IfcAPI();
  await api.Init();
  const modelID = api.OpenModel(new Uint8Array(readFileSync(FIXTURE_PATH)));
  return { api, modelID };
}

describe("IFC real — ARCHICAD 25, IFC2X3 (3 muros exteriores)", () => {
  it("abre el modelo y confirma esquema + herramienta de origen", async () => {
    const { api, modelID } = await openFixture();
    try {
      expect(api.GetModelSchema(modelID)).toBe("IFC2X3");
      const wallIds = api.GetLineIDsWithType(modelID, WebIFC.IFCWALLSTANDARDCASE, false);
      expect(wallIds.size()).toBe(3);
    } finally {
      api.CloseModel(modelID);
    }
  });

  it("extrae GUID, storey y material reales de cada muro", async () => {
    const { api, modelID } = await openFixture();
    try {
      const wallIds = api.GetLineIDsWithType(modelID, WebIFC.IFCWALLSTANDARDCASE, false);
      const names: string[] = [];
      for (let i = 0; i < wallIds.size(); i++) {
        const props = await api.properties.getItemProperties(modelID, wallIds.get(i), false);
        expect(typeof props.GlobalId.value).toBe("string");
        expect(props.GlobalId.value.length).toBeGreaterThan(10);
        names.push(props.Name.value);

        // recursive=true: este muro real asocia material vía
        // IfcMaterialLayerSetUsage (multicapa), NO un IfcMaterial suelto —
        // con recursive=false (como estaba antes) esto devolvía null siempre.
        const materials = await api.properties.getMaterialsProperties(modelID, wallIds.get(i), true, false);
        expect(extractMaterialNames(materials)).toBe("Yttervegg"); // "muro exterior" en noruego, real del fixture
      }
      expect(names.sort()).toEqual(["YVT-A", "YVT-B", "YVT-C"]);

      const spatialStructure = await api.properties.getSpatialStructure(modelID, false);
      // Project > Site > Building > Storey > 3 Wall (jerarquía real de ARCHICAD)
      const storeyNode = spatialStructure.children[0].children[0].children[0];
      const storeyProps = await api.properties.getItemProperties(modelID, storeyNode.expressID, false);
      expect(storeyProps.Name.value).toBe("1. etasje"); // "1er piso" en noruego
      expect(storeyNode.children.length).toBe(3);
    } finally {
      api.CloseModel(modelID);
    }
  });

  it("la política de cantidad elige NetSideArea, NO NetFootprintArea (bug real detectado con este fixture)", async () => {
    const { api, modelID } = await openFixture();
    try {
      const wallIds = api.GetLineIDsWithType(modelID, WebIFC.IFCWALLSTANDARDCASE, false);
      const firstWallId = wallIds.get(0); // YVT-A
      const psets = await api.properties.getPropertySets(modelID, firstWallId, true, false);

      const candidates = collectQuantityCandidates(psets);
      // El Qto real trae 4 quantities de kind "area": Gross/NetFootprintArea Y
      // Gross/NetSideArea — antes de la corrección, el patrón /^Net.*Area$/i
      // matcheaba AMBAS "Net*Area" (FootprintArea y SideArea) como si fueran
      // la misma medición con valores distintos, y la política fallaba
      // cerrado (ambiguous) por error.
      const areaCandidates = candidates.filter((c) => c.kind === "area");
      expect(areaCandidates.map((c) => c.name).sort()).toEqual([
        "GrossFootprintArea",
        "GrossSideArea",
        "NetFootprintArea",
        "NetSideArea",
      ]);

      const selection = selectCanonicalQuantity(candidates, ["area", "volume", "length"]);
      expect(selection?.ambiguous).toBe(false);
      if (!selection?.ambiguous) {
        expect(selection?.kind).toBe("area");
        expect(selection?.property).toBe("BaseQuantities.NetSideArea");
        expect(selection?.value).toBeCloseTo(23.2182062609, 6);
      }
    } finally {
      api.CloseModel(modelID);
    }
  });

  it("lee la unidad de longitud real del proyecto (milímetros) sin asumir metros", async () => {
    const { api, modelID } = await openFixture();
    try {
      const projectIds = api.GetLineIDsWithType(modelID, WebIFC.IFCPROJECT, false);
      const scales = await readProjectUnitScales(api, modelID, projectIds.get(0));
      expect(scales.lengthToMetres).toBe(0.001); // MILLI.METRE real del archivo
      expect(scales.areaToSquareMetres).toBe(1); // SQUARE_METRE sin prefijo
      expect(scales.volumeToCubicMetres).toBe(1); // CUBIC_METRE sin prefijo

      // Si el rubro económico costeara por longitud en vez de área, un
      // "Length"=8599.33 (en mm reales del archivo) debe escalarse a 8.59933
      // metros — no reportarse como 8599.33 "m" (~1000x de error).
      const wallIds = api.GetLineIDsWithType(modelID, WebIFC.IFCWALLSTANDARDCASE, false);
      const psets = await api.properties.getPropertySets(modelID, wallIds.get(0), true, false);
      const lengthCandidate = collectQuantityCandidates(psets).find((c) => c.kind === "length" && c.name === "Length");
      expect(lengthCandidate?.value).toBeCloseTo(8599.33565217, 5);
      const scale = scaleForKind("length", scales);
      expect(scale).toBe(0.001);
      expect((lengthCandidate!.value * scale!)).toBeCloseTo(8.59933565217, 5);
    } finally {
      api.CloseModel(modelID);
    }
  });

  it("caso económico reproducible: 3 muros -> 1 rubro, sin double counting (enunciado del batch, con valores reales)", async () => {
    const { api, modelID } = await openFixture();
    try {
      const wallIds = api.GetLineIDsWithType(modelID, WebIFC.IFCWALLSTANDARDCASE, false);
      const bimElements: BimElement[] = [];
      for (let i = 0; i < wallIds.size(); i++) {
        const expressID = wallIds.get(i);
        const props = await api.properties.getItemProperties(modelID, expressID, false);
        const psets = await api.properties.getPropertySets(modelID, expressID, true, false);
        const selection = selectCanonicalQuantity(collectQuantityCandidates(psets), ["area", "volume", "length"]);
        if (!selection || selection.ambiguous) throw new Error("no debería ser ambiguo en este fixture");
        bimElements.push({
          id: `el-${expressID}`,
          bim_model_id: "model-archicad-test",
          project_id: "proj-test",
          ifc_guid: props.GlobalId.value,
          ifc_type: "IfcWallStandardCase",
          express_id: expressID,
          name: props.Name.value,
          building_storey: "1. etasje",
          material: "Yttervegg",
          properties: {},
          quantity_type: selection.kind,
          quantity_value: selection.value,
          quantity_unit: "m2",
          quantity_source: "IFC_QTO",
          quantity_property: selection.property,
          created_at: new Date().toISOString(),
          group_id: null,
        });
      }

      // Excel/base económica (importador existente, ver import-budget-dialog.tsx):
      const rubro: BudgetItem = {
        id: "budget-mamposteria",
        project_id: "proj-test",
        parent_id: null,
        code: "1.1",
        description: "Mampostería cerámica 15 cm",
        unit: "m2",
        quantity: null,
        unit_price: 185000,
        subtotal: 0,
        sort_order: 0,
        start_date: null,
        end_date: null,
        depends_on: null,
        quantity_per_unit: null,
        created_at: new Date().toISOString(),
      };

      const aggregation = aggregateElementsForBudgetItem(bimElements, rubro);
      expect(aggregation.incompatible).toHaveLength(0);
      expect(aggregation.compatible).toHaveLength(3);
      // 23.2182062609 + 22.9725109565 + 19.5327766957 = 65.7234939131 (suma
      // cruda), redondeado a la precisión de budget_items.quantity
      // (numeric(18,4)) por aggregateElementsForBudgetItem vía roundQuantity4
      // — es el mismo valor que se persistiría si se confirma "Actualizar
      // cant. presupuesto", no un valor solo para mostrar en pantalla.
      expect(aggregation.totalQuantity).toBe(65.7235);

      expect(unitsCompatibleForCosting("m2", rubro.unit)).toBe(true);
      // calcLineSubtotal replica ROUND(quantity * unit_price, 2) de
      // budget_items (0028_construccion_pro.sql) — NO una multiplicación
      // flotante cruda. 65.7235 × 185.000 = 12.158.847,50 exacto.
      const total = calcLineSubtotal(aggregation.totalQuantity!, rubro.unit_price!);
      expect(total).toBe(12_158_847.5);
    } finally {
      api.CloseModel(modelID);
    }
  });
});
