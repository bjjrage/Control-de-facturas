// Política explícita de selección de cantidad — capa única entre "cantidades
// disponibles en el IFC" y "cantidad canónica usada para costeo". Nada de
// "agarra la primera que aparezca": cada tipo de cantidad tiene un orden de
// preferencia de NOMBRE documentado acá, y si dos candidatos empatan en
// prioridad con valores distintos, se falla cerrado (no se inventa cuál es
// la correcta) en lugar de promediar o tomar la primera por orden de
// aparición en el archivo.
//
// Caso motivador (double counting / ambigüedad):
//   IfcWall -> Qto_WallBaseQuantities con GrossSideArea=51.2 y
//   NetSideArea=46.7. Sumar ambas no tiene sentido (son la misma pared
//   medida de dos formas). La política dice: para "area" en muros, preferí
//   Net sobre Gross — se usa 46.7, con procedencia
//   "Qto_WallBaseQuantities.NetSideArea".
//
// Si en cambio hubiera DOS quantities con el mismo nivel de prioridad (ej.
// dos "NetSideArea" en dos Quantity Sets distintos) con valores distintos,
// eso es ambigüedad real — no hay forma correcta de elegir sin más contexto,
// así que se falla cerrado (quantity = null, ambiguous = true) en vez de
// adivinar.
export type QuantityKind = "length" | "area" | "volume" | "count" | "weight";

export interface RawQuantityCandidate {
  kind: QuantityKind;
  value: number;
  name: string; // ej. "NetSideArea"
  psetName: string; // ej. "Qto_WallBaseQuantities"
}

export interface CanonicalQuantity {
  kind: QuantityKind;
  value: number;
  property: string; // "{psetName}.{name}"
  ambiguous: false;
}

export interface AmbiguousQuantity {
  ambiguous: true;
  kind: QuantityKind;
  candidates: RawQuantityCandidate[];
}

export type QuantitySelection = CanonicalQuantity | AmbiguousQuantity | null;

// Orden de preferencia de NOMBRE dentro de un kind, aplicado en este orden:
// el primer patrón que matchee a >=1 candidato define el "tier" ganador.
// Genérico por kind (no por tipo IFC) — suficiente para los tipos que hoy
// soporta el parser (ver RELEVANT_TYPES en ifc-parser.client.ts). Si en el
// futuro un tipo necesita otra prioridad (ej. puertas: Area de hoja vs Area
// de vano), agregar una tabla por ifcType antes de generalizar esta.
//
// CUIDADO (encontrado con un IFC real de ARCHICAD, no en el fixture
// sintético): "NetFootprintArea" también matchea /^Net.*Area$/i — un patrón
// tan genérico trata "área de proyección horizontal" y "área lateral de
// pared" (NetSideArea, la que de verdad se usa para costear m² de muro)
// como si fueran mediciones alternativas de LO MISMO, y las declara
// "ambiguas" entre sí cuando en realidad son conceptos distintos. Por eso
// "SideArea" tiene su propio tier antes del genérico "*Area", y el genérico
// excluye explícitamente Footprint/Floor (áreas de proyección horizontal,
// no de costeo por m² de superficie lateral) salvo que sea la única opción.
const NAME_PRIORITY_BY_KIND: Record<QuantityKind, RegExp[]> = {
  area: [
    /^NetSideArea$/i,
    /^GrossSideArea$/i,
    /^Net(?!.*(?:Footprint|Floor)).*Area$/i,
    /^Gross(?!.*(?:Footprint|Floor)).*Area$/i,
    /Area$/i,
  ],
  volume: [/^Net.*Volume$/i, /^Gross.*Volume$/i, /Volume$/i],
  length: [/^Length$/i, /Length$/i],
  count: [/^Count$/i, /Count$/i],
  weight: [/^NetWeight$/i, /^GrossWeight$/i, /Weight$/i],
};

function sameValue(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}

export function selectCanonicalQuantity(
  candidates: RawQuantityCandidate[],
  preferredKinds: QuantityKind[]
): QuantitySelection {
  for (const kind of preferredKinds) {
    const ofKind = candidates.filter((c) => c.kind === kind);
    if (ofKind.length === 0) continue;

    const patterns = NAME_PRIORITY_BY_KIND[kind];
    for (const pattern of patterns) {
      const tier = ofKind.filter((c) => pattern.test(c.name));
      if (tier.length === 0) continue;

      const distinctValues = new Set(tier.map((c) => c.value));
      if (distinctValues.size > 1 && !tier.every((c) => sameValue(c.value, tier[0].value))) {
        return { ambiguous: true, kind, candidates: tier };
      }

      const winner = tier[0];
      return { kind, value: winner.value, property: `${winner.psetName}.${winner.name}`, ambiguous: false };
    }

    // Ningún patrón nombrado matcheó, pero hay candidatos del kind buscado:
    // tomar el único si hay uno solo, fallar cerrado si hay varios distintos.
    if (ofKind.length === 1) {
      const only = ofKind[0];
      return { kind, value: only.value, property: `${only.psetName}.${only.name}`, ambiguous: false };
    }
    const distinct = new Set(ofKind.map((c) => c.value));
    if (distinct.size === 1) {
      const first = ofKind[0];
      return { kind, value: first.value, property: `${first.psetName}.${first.name}`, ambiguous: false };
    }
    return { ambiguous: true, kind, candidates: ofKind };
  }

  return null;
}
