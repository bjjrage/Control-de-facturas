// Conversión explícita y testeada de las unidades declaradas por el propio
// IFC (IfcUnitAssignment) a las unidades base que persistimos (m, m², m³).
//
// Motivador real (no hipotético): un IFC2X3 exportado por ARCHICAD 25 declara
// LENGTHUNIT = milímetro (IfcSIUnit con Prefix .MILLI.) pero AREAUNIT/
// VOLUMEUNIT sin prefijo (metro cuadrado/cúbico directos) — ver
// lib/bim/__tests__/fixtures/archicad-ifc2x3-walls.ifc. Un IfcQuantityLength
// como "Length"=8599.33 está en MILÍMETROS: guardarlo como si fueran 8599.33
// metros sería un error de ~1000x. Área y volumen, en cambio, YA vienen en
// m²/m³ en ese mismo archivo porque así los declaró el exportador — no se
// derivan del prefijo de longitud (son unidades SI independientes en IFC).
//
// Política: solo convertimos cuando la unidad declarada es un IfcSIUnit con
// un prefijo SI reconocido. Si el proyecto usa una unidad no-SI (ej.
// IfcConversionBasedUnit para pies/pulgadas) o no se puede leer la
// asignación de unidades, se falla cerrado: NO se adivina un factor, la
// cantidad de ese tipo queda sin reportar en vez de arriesgar un valor mal
// escalado silenciosamente.
import type { IfcAPI } from "web-ifc";

const SI_PREFIX_SCALE: Record<string, number> = {
  EXA: 1e18,
  PETA: 1e15,
  TERA: 1e12,
  GIGA: 1e9,
  MEGA: 1e6,
  KILO: 1e3,
  HECTO: 1e2,
  DECA: 1e1,
  DECI: 1e-1,
  CENTI: 1e-2,
  MILLI: 1e-3,
  MICRO: 1e-6,
  NANO: 1e-9,
  PICO: 1e-12,
  FEMTO: 1e-15,
  ATTO: 1e-18,
};

export interface ProjectUnitScales {
  /** Factor para convertir una IfcQuantityLength del proyecto a metros. null = no determinable, no convertir. */
  lengthToMetres: number | null;
  /** Factor para convertir una IfcQuantityArea del proyecto a m². null = no determinable. */
  areaToSquareMetres: number | null;
  /** Factor para convertir una IfcQuantityVolume del proyecto a m³. null = no determinable. */
  volumeToCubicMetres: number | null;
}

function unwrap(val: unknown): unknown {
  if (val && typeof val === "object" && "value" in (val as Record<string, unknown>)) {
    return (val as { value: unknown }).value;
  }
  return val;
}

// Factor de escala de una IfcSIUnit (metro/m²/m³) a su unidad base sin
// prefijo, elevado a la potencia dimensional (1 para longitud, 2 para área,
// 3 para volumen) — un prefijo MILLI en longitud escala el área en (1e-3)²
// SOLO si el área se derivara del prefijo de longitud, cosa que IFC NO hace:
// cada unidad SI se declara con su propio prefijo independiente. Por eso acá
// se lee el prefijo de CADA unidad por separado, sin elevar nada al cuadrado.
function siUnitScale(unit: { Prefix?: unknown } | null | undefined): number | null {
  if (!unit) return null;
  const prefix = unwrap(unit.Prefix) as string | null | undefined;
  if (!prefix) return 1;
  return SI_PREFIX_SCALE[prefix] ?? null;
}

export async function readProjectUnitScales(api: IfcAPI, modelID: number, projectExpressId: number): Promise<ProjectUnitScales> {
  const result: ProjectUnitScales = { lengthToMetres: null, areaToSquareMetres: null, volumeToCubicMetres: null };
  try {
    const project = await api.properties.getItemProperties(modelID, projectExpressId, false);
    const unitsInContextId = (unwrap(project?.UnitsInContext) ?? (project?.UnitsInContext as { value?: number })?.value) as
      | number
      | undefined;
    if (!unitsInContextId) return result;

    const unitAssignment = await api.properties.getItemProperties(modelID, unitsInContextId, true);
    const units = (unitAssignment?.Units as Array<Record<string, unknown>>) ?? [];

    for (const unit of units) {
      const unitType = unwrap(unit.UnitType) as string | undefined;
      // Solo IfcSIUnit trae Prefix como campo propio; IfcConversionBasedUnit
      // (pies, pulgadas, etc.) no es una unidad SI y no se auto-convierte acá.
      const isSiUnit = "Prefix" in unit;
      if (!isSiUnit || !unitType) continue;
      const scale = siUnitScale(unit as { Prefix?: unknown });
      if (scale == null) continue;
      if (unitType === "LENGTHUNIT") result.lengthToMetres = scale;
      else if (unitType === "AREAUNIT") result.areaToSquareMetres = scale;
      else if (unitType === "VOLUMEUNIT") result.volumeToCubicMetres = scale;
    }
  } catch {
    // Sin asignación de unidades legible — se sigue con todo en null (fail closed).
  }
  return result;
}

export function scaleForKind(
  kind: "length" | "area" | "volume" | "count" | "weight",
  scales: ProjectUnitScales
): number | null {
  if (kind === "length") return scales.lengthToMetres;
  if (kind === "area") return scales.areaToSquareMetres;
  if (kind === "volume") return scales.volumeToCubicMetres;
  return 1; // count/weight: sin escala de longitud involucrada en este slice.
}
