// Test de integración contra un IFC real (no sintético): valida que el motor
// web-ifc realmente abre el archivo, resuelve GUID/tipo, el Quantity Set
// explícito (Qto_WallBaseQuantities.NetSideArea) y el material asociado.
//
// Fixture: lib/bim/__tests__/fixtures/sample-wall.ifc — IFC4 STEP escrito a
// mano (1 IfcProject > IfcSite > IfcBuilding > IfcBuildingStorey conteniendo
// 1 IfcWallStandardCase con geometría IfcExtrudedAreaSolid, un
// IfcElementQuantity con NetSideArea=742 m² y un IfcMaterial "Ceramic Brick").
//
// Esquema validado: IFC4. NO se validó IFC2X3 ni IFC4X3 — queda como límite
// conocido (ver PR). Este test corre en Node (no browser): usa la condición
// "node" del package.json de web-ifc (build headless), NO el parser
// client-side real (lib/bim/ifc-parser.client.ts, que requiere fetch() de un
// .wasm servido por Next.js y no puede ejecutarse fuera de un browser). La
// lógica de extracción validada acá (recorrido de psets, prioridad de
// Quantity Set, lectura de material) es la misma que usa el parser client.
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import * as WebIFC from "web-ifc";
import { extractQuantity } from "../ifc-parser.client";

const FIXTURE_PATH = join(__dirname, "fixtures", "sample-wall.ifc");

describe("IFC fixture real (IFC4, IfcWallStandardCase + Qto explícito)", () => {
  it("abre el modelo y resuelve el esquema declarado", async () => {
    const api = new WebIFC.IfcAPI();
    await api.Init();
    const buffer = new Uint8Array(readFileSync(FIXTURE_PATH));
    const modelID = api.OpenModel(buffer);
    try {
      expect(modelID).toBeGreaterThanOrEqual(0);
      expect(api.GetModelSchema(modelID)).toBe("IFC4");
    } finally {
      api.CloseModel(modelID);
    }
  });

  it("extrae GUID, tipo, GlobalId, nivel, material y el Quantity Set explícito del muro", async () => {
    const api = new WebIFC.IfcAPI();
    await api.Init();
    const buffer = new Uint8Array(readFileSync(FIXTURE_PATH));
    const modelID = api.OpenModel(buffer);
    try {
      const wallIds = api.GetLineIDsWithType(modelID, WebIFC.IFCWALLSTANDARDCASE, false);
      expect(wallIds.size()).toBe(1);
      const expressID = wallIds.get(0);

      const props = await api.properties.getItemProperties(modelID, expressID, false);
      expect(props.GlobalId.value).toBe("7nYLVQ8vX5UOfmGnk9YSKh");
      expect(props.Name.value).toBe("External Ceramic Wall 150");

      const materials = await api.properties.getMaterialsProperties(modelID, expressID, false, false);
      expect(materials[0]?.Name?.value).toBe("Ceramic Brick");

      const psets = await api.properties.getPropertySets(modelID, expressID, true, false);
      const qto = psets.find((p: { Name?: { value?: string } }) => p.Name?.value === "Qto_WallBaseQuantities");
      expect(qto).toBeDefined();
      const netSideArea = qto.Quantities.find((q: { Name?: { value?: string } }) => q.Name?.value === "NetSideArea");
      expect(netSideArea).toBeDefined();
      expect(netSideArea.AreaValue.value).toBe(742);

      // La estructura espacial: Project > Site > Building > Storey > Wall
      // (IfcRelAggregates + IfcRelContainedInSpatialStructure). Nota: web-ifc
      // devuelve el `type` de la raíz en mayúsculas ("IFCPROJECT") pero el de
      // los hijos en PascalCase ("IfcBuildingStorey") — hay que comparar
      // case-insensitive (bug real que este fixture detectó en el parser,
      // corregido en ifc-parser.client.ts).
      const spatialStructure = await api.properties.getSpatialStructure(modelID, false);
      const storeyNode = spatialStructure.children[0].children[0].children[0];
      expect(storeyNode.type.toUpperCase()).toBe("IFCBUILDINGSTOREY");
      const storeyProps = await api.properties.getItemProperties(modelID, storeyNode.expressID, false);
      expect(storeyProps.Name.value).toBe("Nivel 1");
      const wallInStorey = storeyNode.children.some((c: { expressID: number }) => c.expressID === expressID);
      expect(wallInStorey).toBe(true);
    } finally {
      api.CloseModel(modelID);
    }
  });

  it("extractQuantity (lógica real del parser) resuelve el Qto explícito por su tipo IFC numérico", async () => {
    // Regresión: web-ifc devuelve pset.type / quantity.type como el ID
    // numérico IFC (ej. WebIFC.IFCQUANTITYAREA === 2044713172), no como
    // string. Un lookup por nombre de texto no matchea nunca y esta función
    // devolvía null siempre — bug real que este fixture detectó.
    const api = new WebIFC.IfcAPI();
    await api.Init();
    const buffer = new Uint8Array(readFileSync(FIXTURE_PATH));
    const modelID = api.OpenModel(buffer);
    try {
      const wallIds = api.GetLineIDsWithType(modelID, WebIFC.IFCWALLSTANDARDCASE, false);
      const expressID = wallIds.get(0);
      const psets = await api.properties.getPropertySets(modelID, expressID, true, false);

      const result = extractQuantity(psets, ["area", "volume", "length"]);
      expect(result).not.toBeNull();
      expect(result?.kind).toBe("area");
      expect(result?.value).toBe(742);
      expect(result?.property).toBe("Qto_WallBaseQuantities.NetSideArea");
    } finally {
      api.CloseModel(modelID);
    }
  });

  it("genera geometría triangulada para el elemento (necesaria para el viewer 3D)", async () => {
    const api = new WebIFC.IfcAPI();
    await api.Init();
    const buffer = new Uint8Array(readFileSync(FIXTURE_PATH));
    const modelID = api.OpenModel(buffer);
    try {
      const flatMeshes = api.LoadAllGeometry(modelID);
      expect(flatMeshes.size()).toBeGreaterThan(0);
      const flatMesh = flatMeshes.get(0);
      expect(flatMesh.geometries.size()).toBeGreaterThan(0);
      const placed = flatMesh.geometries.get(0);
      const geometry = api.GetGeometry(modelID, placed.geometryExpressID);
      expect(geometry.GetVertexDataSize()).toBeGreaterThan(0);
      expect(geometry.GetIndexDataSize()).toBeGreaterThan(0);
      geometry.delete();
    } finally {
      api.CloseModel(modelID);
    }
  });
});
