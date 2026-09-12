// Parser IFC client-side (web-ifc, WASM). No Autodesk Platform Services ni
// otro servicio cloud pago — corre 100% en el browser del usuario.
//
// Alcance del MVP: extraer, por cada elemento de tipo constructivo relevante,
// GUID / tipo / nombre / nivel / material / property sets / quantity sets.
// Prioridad de cantidad (nunca se inventa, nunca se pierde la unidad):
//   1. IFC Quantity Sets explícitos (Qto_*)      -> quantity_source IFC_QTO
//   2. Propiedad cuantitativa explícita (Pset_*) -> quantity_source IFC_PROPERTY
//   3. Geometría derivada — NO implementado en este slice (requeriría
//      triangular la malla para cada sólido); un elemento sin Qto/Pset queda
//      con quantity_value = null y se marca visualmente en la UI.
"use client";

import * as WebIFC from "web-ifc";

export interface ParsedIfcElement {
  ifcGuid: string;
  ifcType: string;
  expressId: number;
  name: string | null;
  buildingStorey: string | null;
  material: string | null;
  properties: Record<string, unknown>;
  quantityType: "length" | "area" | "volume" | "count" | "weight" | null;
  quantityValue: number | null;
  quantityUnit: string | null;
  quantitySource: "IFC_QTO" | "IFC_PROPERTY" | null;
  quantityProperty: string | null;
}

export interface ParsedIfcModel {
  schema: string | null;
  elements: ParsedIfcElement[];
}

// Tipos constructivos relevantes para cómputo métrico. Se ignoran a propósito
// tipos puramente espaciales/organizativos (IfcSpace, IfcBuildingStorey, etc.)
const RELEVANT_TYPES: { type: number; name: string; preferredQty: Array<"volume" | "area" | "length" | "count"> }[] = [
  { type: WebIFC.IFCWALL, name: "IfcWall", preferredQty: ["area", "volume", "length"] },
  { type: WebIFC.IFCWALLSTANDARDCASE, name: "IfcWallStandardCase", preferredQty: ["area", "volume", "length"] },
  { type: WebIFC.IFCSLAB, name: "IfcSlab", preferredQty: ["area", "volume"] },
  { type: WebIFC.IFCCOLUMN, name: "IfcColumn", preferredQty: ["length", "volume"] },
  { type: WebIFC.IFCBEAM, name: "IfcBeam", preferredQty: ["length", "volume"] },
  { type: WebIFC.IFCDOOR, name: "IfcDoor", preferredQty: ["count", "area"] },
  { type: WebIFC.IFCWINDOW, name: "IfcWindow", preferredQty: ["count", "area"] },
  { type: WebIFC.IFCROOF, name: "IfcRoof", preferredQty: ["area", "volume"] },
  { type: WebIFC.IFCSTAIR, name: "IfcStair", preferredQty: ["count", "volume"] },
  { type: WebIFC.IFCFOOTING, name: "IfcFooting", preferredQty: ["volume", "length"] },
  { type: WebIFC.IFCCOVERING, name: "IfcCovering", preferredQty: ["area", "volume"] },
  { type: WebIFC.IFCPLATE, name: "IfcPlate", preferredQty: ["area", "volume"] },
  { type: WebIFC.IFCMEMBER, name: "IfcMember", preferredQty: ["length", "volume"] },
  { type: WebIFC.IFCRAILING, name: "IfcRailing", preferredQty: ["length"] },
];

// web-ifc devuelve el `type` de cada quantity/pset como el ID numérico IFC
// (el mismo valor que las constantes exportadas por el paquete, ej.
// WebIFC.IFCQUANTITYAREA === 2044713172), NO como el nombre en texto. Un
// lookup por nombre de string acá silenciosamente no matchea nunca — bug
// real detectado por el fixture de test (lib/bim/__tests__/ifc-fixture.spec.ts).
const QTO_KIND_BY_TYPE: Record<number, { kind: "length" | "area" | "volume" | "count" | "weight"; field: string }> = {
  [WebIFC.IFCQUANTITYLENGTH]: { kind: "length", field: "LengthValue" },
  [WebIFC.IFCQUANTITYAREA]: { kind: "area", field: "AreaValue" },
  [WebIFC.IFCQUANTITYVOLUME]: { kind: "volume", field: "VolumeValue" },
  [WebIFC.IFCQUANTITYCOUNT]: { kind: "count", field: "CountValue" },
  [WebIFC.IFCQUANTITYWEIGHT]: { kind: "weight", field: "WeightValue" },
};

const IFCELEMENTQUANTITY_TYPE = WebIFC.IFCELEMENTQUANTITY;

const QTO_UNIT_BY_KIND: Record<string, string> = {
  length: "m",
  area: "m2",
  volume: "m3",
  count: "u",
  weight: "kg",
};

function unwrap(val: unknown): unknown {
  if (val && typeof val === "object" && "value" in (val as Record<string, unknown>)) {
    return (val as { value: unknown }).value;
  }
  return val;
}

async function buildStoreyMap(api: WebIFC.IfcAPI, modelID: number): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  try {
    const root = await api.properties.getSpatialStructure(modelID, false);
    const walk = async (node: { expressID: number; type: string; children: unknown[] }, storeyName: string | null) => {
      let current = storeyName;
      if (node.type.toUpperCase() === "IFCBUILDINGSTOREY") {
        try {
          const props = await api.properties.getItemProperties(modelID, node.expressID);
          current = (unwrap(props?.Name) as string) || (unwrap(props?.LongName) as string) || null;
        } catch {
          // ignore, keep parent storey name
        }
      }
      if (current) map.set(node.expressID, current);
      for (const child of node.children as Array<{ expressID: number; type: string; children: unknown[] }>) {
        await walk(child, current);
      }
    };
    await walk(root as unknown as { expressID: number; type: string; children: unknown[] }, null);
  } catch {
    // Estructura espacial no disponible (IFC incompleto) — se sigue sin nivel.
  }
  return map;
}

export function extractQuantity(
  psets: Array<Record<string, unknown>>,
  preferredKinds: Array<"volume" | "area" | "length" | "count">
): { kind: "length" | "area" | "volume" | "count" | "weight"; value: number; property: string } | null {
  const found: { kind: "length" | "area" | "volume" | "count" | "weight"; value: number; property: string }[] = [];

  for (const pset of psets) {
    const isQto = pset.type === IFCELEMENTQUANTITY_TYPE || Array.isArray(pset.Quantities);
    if (!isQto) continue;
    const psetName = String(unwrap(pset.Name) ?? "");
    const quantities = (pset.Quantities as Array<Record<string, unknown>>) ?? [];
    for (const q of quantities) {
      const qType = (q as { type?: unknown }).type;
      const spec = typeof qType === "number" ? QTO_KIND_BY_TYPE[qType] : undefined;
      if (!spec) continue;
      const raw = unwrap(q[spec.field]);
      const value = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(value)) continue;
      const qName = String(unwrap(q.Name) ?? spec.field);
      found.push({ kind: spec.kind, value, property: `${psetName}.${qName}` });
    }
  }

  for (const kind of preferredKinds) {
    const match = found.find((f) => f.kind === kind);
    if (match) return match;
  }
  return found[0] ?? null;
}

function extractNumericPsetFallback(
  psets: Array<Record<string, unknown>>
): { kind: "length" | "area" | "volume"; value: number; property: string } | null {
  const keywordsByKind: Record<string, RegExp> = {
    area: /area/i,
    volume: /volu?men|volume/i,
    length: /longitud|length|espesor|thickness/i,
  };
  for (const pset of psets) {
    const props = (pset.HasProperties as Array<Record<string, unknown>>) ?? [];
    const psetName = String(unwrap(pset.Name) ?? "");
    for (const p of props) {
      const name = String(unwrap(p.Name) ?? "");
      const raw = unwrap((p as { NominalValue?: unknown }).NominalValue);
      const value = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(value)) continue;
      for (const [kind, re] of Object.entries(keywordsByKind)) {
        if (re.test(name)) {
          return { kind: kind as "length" | "area" | "volume", value, property: `${psetName}.${name}` };
        }
      }
    }
  }
  return null;
}

export async function parseIfcFile(
  file: File,
  onProgress?: (message: string) => void
): Promise<ParsedIfcModel> {
  onProgress?.("Cargando motor IFC…");
  const api = new WebIFC.IfcAPI();
  api.SetWasmPath("/wasm/");
  await api.Init();

  const buffer = new Uint8Array(await file.arrayBuffer());
  onProgress?.("Abriendo modelo…");
  const modelID = api.OpenModel(buffer);
  if (modelID < 0) {
    throw new Error("No se pudo abrir el archivo IFC. Verificá que sea un .ifc válido.");
  }

  try {
    const schema = api.GetModelSchema?.(modelID) ?? null;
    onProgress?.("Mapeando niveles del edificio…");
    const storeyMap = await buildStoreyMap(api, modelID);

    const elements: ParsedIfcElement[] = [];
    let processed = 0;

    for (const typeDef of RELEVANT_TYPES) {
      const ids = api.GetLineIDsWithType(modelID, typeDef.type, false);
      for (let i = 0; i < ids.size(); i++) {
        const expressID = ids.get(i);
        processed++;
        if (processed % 50 === 0) onProgress?.(`Procesando elementos… (${processed})`);

        let line: Record<string, unknown>;
        try {
          line = await api.properties.getItemProperties(modelID, expressID, false);
        } catch {
          continue;
        }

        const ifcGuid = String(unwrap(line?.GlobalId) ?? `${expressID}`);
        const name = (unwrap(line?.Name) as string) || null;

        let material: string | null = null;
        try {
          const materials = await api.properties.getMaterialsProperties(modelID, expressID, false, false);
          const first = materials?.[0];
          material =
            (unwrap(first?.Name) as string) ||
            (unwrap((first?.Materials as Array<Record<string, unknown>>)?.[0]?.Name) as string) ||
            null;
        } catch {
          // sin material asociado
        }

        let psets: Array<Record<string, unknown>> = [];
        try {
          psets = await api.properties.getPropertySets(modelID, expressID, true, false);
        } catch {
          psets = [];
        }

        const qto = extractQuantity(psets, typeDef.preferredQty);
        const fallback = qto ? null : extractNumericPsetFallback(psets);

        const quantityType = qto?.kind ?? fallback?.kind ?? null;
        const quantityValue = qto?.value ?? fallback?.value ?? null;
        const quantitySource: "IFC_QTO" | "IFC_PROPERTY" | null = qto ? "IFC_QTO" : fallback ? "IFC_PROPERTY" : null;
        const quantityProperty = qto?.property ?? fallback?.property ?? null;
        const quantityUnit = quantityType ? QTO_UNIT_BY_KIND[quantityType] : null;

        const flatProps: Record<string, unknown> = {};
        for (const pset of psets) {
          const psetName = String(unwrap(pset.Name) ?? "pset");
          const props = (pset.HasProperties as Array<Record<string, unknown>>) ?? [];
          for (const p of props) {
            const pName = String(unwrap(p.Name) ?? "");
            const pVal = unwrap((p as { NominalValue?: unknown }).NominalValue);
            if (pName) flatProps[`${psetName}.${pName}`] = pVal;
          }
        }

        elements.push({
          ifcGuid,
          ifcType: typeDef.name,
          expressId: expressID,
          name,
          buildingStorey: storeyMap.get(expressID) ?? null,
          material,
          properties: flatProps,
          quantityType,
          quantityValue,
          quantityUnit,
          quantitySource,
          quantityProperty,
        });
      }
    }

    return { schema: schema ? String(schema) : null, elements };
  } finally {
    api.CloseModel(modelID);
  }
}
