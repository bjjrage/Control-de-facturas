// Catálogo de costos AMPLIADO para el benchmark adversarial del matcher
// semántico DeepSeek. Objetos BudgetItem en memoria — NUNCA toca Supabase.
// A propósito incluye pares casi-idénticos (misma familia, distinta
// resistencia/espesor/material) para forzar al modelo a discriminar de
// verdad, no a matchear por similitud textual.
import type { BudgetItem } from "@/lib/types";

function item(overrides: Pick<BudgetItem, "code" | "description" | "unit" | "unit_price">): BudgetItem {
  return {
    id: `bench-${overrides.code}`,
    project_id: "bench-adversarial-project",
    parent_id: null,
    quantity: null,
    subtotal: 0,
    sort_order: 0,
    start_date: null,
    end_date: null,
    depends_on: null,
    quantity_per_unit: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

export const BENCH_CATALOG: BudgetItem[] = [
  // --- Hormigones por resistencia (notación H, kg/cm2) --------------------
  item({ code: "HOR-H20", description: "Hormigón estructural H20", unit: "m3", unit_price: 620000 }),
  item({ code: "HOR-H25", description: "Hormigón estructural H25", unit: "m3", unit_price: 690000 }),
  item({ code: "HOR-H30", description: "Hormigón estructural H30", unit: "m3", unit_price: 780000 }),
  item({ code: "HOR-H35", description: "Hormigón estructural H35", unit: "m3", unit_price: 830000 }),
  item({ code: "HOR-H40", description: "Hormigón estructural H40", unit: "m3", unit_price: 860000 }),
  item({ code: "HOR-POBRE", description: "Hormigón pobre de limpieza H15", unit: "m3", unit_price: 410000 }),
  // --- Hormigones por clase Eurocódigo (notación C, MPa) ------------------
  // Nunca se le da al modelo una tabla de equivalencia H<->C: si un elemento
  // llega con clase C, la respuesta correcta esperada es REVIEW (no hay
  // evidencia textual de equivalencia exacta con ningún H-code) salvo que el
  // propio caso incluya la clase C también en el catálogo.
  item({ code: "HOR-C2530", description: "Hormigón C25/30", unit: "m3", unit_price: 700000 }),
  item({ code: "HOR-C3037", description: "Hormigón C30/37", unit: "m3", unit_price: 790000 }),
  item({ code: "HOR-C3545", description: "Hormigón C35/45", unit: "m3", unit_price: 840000 }),
  // --- Acero -----------------------------------------------------------------
  item({ code: "ACE-CA50", description: "Acero CA-50", unit: "kg", unit_price: 7200 }),
  item({ code: "ACE-CA60", description: "Acero CA-60", unit: "kg", unit_price: 7500 }),
  // --- Mampostería cerámica por espesor ---------------------------------------
  item({ code: "MAM-CER-10", description: "Mampostería cerámica 10 cm", unit: "m2", unit_price: 162000 }),
  item({ code: "MAM-CER-12", description: "Mampostería cerámica 12 cm", unit: "m2", unit_price: 172000 }),
  item({ code: "MAM-CER-15", description: "Mampostería cerámica 15 cm", unit: "m2", unit_price: 185000 }),
  item({ code: "MAM-CER-18", description: "Mampostería cerámica 18 cm", unit: "m2", unit_price: 199000 }),
  item({ code: "MAM-CER-20", description: "Mampostería cerámica 20 cm", unit: "m2", unit_price: 212000 }),
  // --- Mampostería de otros materiales (distractores de familia) -------------
  item({ code: "MAM-LAD-15", description: "Mampostería de ladrillo común 15 cm", unit: "m2", unit_price: 198000 }),
  item({ code: "MAM-BLQ-15", description: "Mampostería de bloque hueco de hormigón 15 cm", unit: "m2", unit_price: 176000 }),
  item({ code: "MAM-DOBLE-25", description: "Mampostería doble cerámica con cámara de aire 25 cm", unit: "m2", unit_price: 245000 }),
  // --- Revoques y pinturas (distractores por ubicación int/ext) ---------------
  item({ code: "REV-INT", description: "Revoque interior a la cal", unit: "m2", unit_price: 58000 }),
  item({ code: "REV-EXT", description: "Revoque exterior impermeable", unit: "m2", unit_price: 71000 }),
  item({ code: "PIN-LATEX-INT", description: "Pintura interior látex", unit: "m2", unit_price: 42000 }),
  item({ code: "PIN-ESMALTE-EXT", description: "Pintura esmalte sintético para exterior", unit: "m2", unit_price: 55000 }),
  // --- Pisos (distractores por formato/material) ------------------------------
  item({ code: "PIS-PORC60", description: "Piso porcelanato 60x60", unit: "m2", unit_price: 235000 }),
  item({ code: "PIS-PORC80", description: "Piso porcelanato 80x80", unit: "m2", unit_price: 290000 }),
  item({ code: "PIS-CERAM", description: "Piso cerámico esmaltado", unit: "m2", unit_price: 145000 }),
  item({ code: "PIS-VINIL", description: "Piso vinílico símil madera", unit: "m2", unit_price: 168000 }),
  // --- Impermeabilización / aislación -----------------------------------------
  item({ code: "IMP-MEMB", description: "Impermeabilización con membrana asfáltica", unit: "m2", unit_price: 63000 }),
  item({ code: "AIS-EPS-5", description: "Aislación térmica de poliestireno expandido 5 cm", unit: "m2", unit_price: 47000 }),
];

export function benchItemByCode(code: string): BudgetItem {
  const found = BENCH_CATALOG.find((i) => i.code === code);
  if (!found) throw new Error(`Catálogo del benchmark inconsistente: no existe el rubro ${code}`);
  return found;
}
