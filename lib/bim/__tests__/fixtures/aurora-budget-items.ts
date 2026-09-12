// Catálogo de costos del "Proyecto Demo — Edificio Aurora", exclusivamente
// para test/local. NUNCA se aplica a Supabase — son objetos BudgetItem en
// memoria, del mismo shape que produciría el importador de Excel existente
// (import-budget-dialog.tsx -> importBudgetItems), pero sin tocar ninguna
// base de datos real ni de prueba.
//
// Cantidad inicial NULL a propósito: la cantidad debe provenir del BIM, no
// del catálogo de precios.
import type { BudgetItem } from "@/lib/types";

function item(overrides: Pick<BudgetItem, "code" | "description" | "unit" | "unit_price">): BudgetItem {
  return {
    id: `aurora-${overrides.code}`,
    project_id: "aurora-demo-project",
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

export const AURORA_BUDGET_ITEMS: BudgetItem[] = [
  item({ code: "EST-001", description: "Hormigón estructural H30", unit: "m3", unit_price: 780000 }),
  item({ code: "EST-002", description: "Hormigón estructural H40", unit: "m3", unit_price: 860000 }),
  item({ code: "EST-003", description: "Acero CA-50", unit: "kg", unit_price: 7200 }),
  item({ code: "ALB-001", description: "Mampostería cerámica 15 cm", unit: "m2", unit_price: 185000 }),
  item({ code: "ALB-002", description: "Mampostería cerámica 10 cm", unit: "m2", unit_price: 162000 }),
  item({ code: "ALB-003", description: "Mampostería de ladrillo común 15 cm", unit: "m2", unit_price: 198000 }),
  item({ code: "TER-001", description: "Revoque interior", unit: "m2", unit_price: 58000 }),
  item({ code: "TER-002", description: "Pintura interior látex", unit: "m2", unit_price: 42000 }),
  item({ code: "PIS-001", description: "Piso porcelanato 60x60", unit: "m2", unit_price: 235000 }),
  item({ code: "PIS-002", description: "Piso porcelanato 80x80", unit: "m2", unit_price: 290000 }),
  item({ code: "PIS-003", description: "Piso cerámico", unit: "m2", unit_price: 145000 }),
];

export function auroraItemByCode(code: string): BudgetItem {
  const found = AURORA_BUDGET_ITEMS.find((i) => i.code === code);
  if (!found) throw new Error(`Fixture inconsistente: no existe el rubro ${code}`);
  return found;
}
