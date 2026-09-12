/**
 * Genera el catálogo Excel demo "Edificio Aurora" para el importador REAL de
 * presupuesto (ImportBudgetDialog) durante la certificación E2E.
 *
 * Encabezados elegidos para que el auto-mapeo del diálogo los detecte sin
 * intervención (ver HEADER_VARIANTS en import-budget-dialog.tsx):
 *   codigo / descripcion / unidad / cantidad / precio unitario
 * La columna cantidad queda VACÍA a propósito: la cantidad proviene del IFC.
 *
 * Uso: npx tsx scripts/bim-e2e-gen-catalog-xlsx.ts <ruta-salida.xlsx>
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const XLSX = require("xlsx") as typeof import("xlsx");

const ROWS: Array<[string, string, string, string, number]> = [
  ["EST-001", "Hormigón estructural H30", "m3", "", 780000],
  ["EST-002", "Hormigón estructural H40", "m3", "", 860000],
  ["EST-003", "Acero CA-50", "kg", "", 7200],
  ["ALB-001", "Mampostería cerámica 15 cm", "m2", "", 185000],
  ["ALB-002", "Mampostería cerámica 10 cm", "m2", "", 162000],
  ["ALB-003", "Mampostería ladrillo común 15cm", "m2", "", 198000],
  ["TER-001", "Revoque interior", "m2", "", 58000],
  ["TER-002", "Pintura interior látex", "m2", "", 42000],
  ["PIS-001", "Piso porcelanato 60x60", "m2", "", 235000],
  ["PIS-002", "Piso porcelanato 80x80", "m2", "", 290000],
  ["PIS-003", "Piso cerámico", "m2", "", 145000],
];

function run(): void {
  const out = process.argv[2];
  if (!out) {
    console.error("Uso: tsx scripts/bim-e2e-gen-catalog-xlsx.ts <ruta-salida.xlsx>");
    process.exit(1);
  }
  const sheet = XLSX.utils.aoa_to_sheet([
    ["codigo", "descripcion", "unidad", "cantidad", "precio unitario"],
    ...ROWS,
  ]);
  sheet["!cols"] = [{ wch: 12 }, { wch: 36 }, { wch: 8 }, { wch: 10 }, { wch: 16 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Catalogo");
  XLSX.writeFile(wb, out);
  console.log(`✅ [bim-e2e-catalog] ${ROWS.length} rubros -> ${out}`);
}

run();
