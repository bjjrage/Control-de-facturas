// Local fixture preparation only: no network, no database writes.
import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
const root = path.resolve(import.meta.dirname, "..");
const runDate = process.argv[2] ?? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate) || new Date(`${runDate}T12:00:00Z`).toISOString().slice(0, 10) !== runDate) throw new Error("Use a valid run date YYYY-MM-DD");
const offset = days => { const d = new Date(`${runDate}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const dates = { LL: offset(-3), HH: offset(-2), B: offset(-1) };
const bom = JSON.parse(fs.readFileSync(path.join(root, "test/fixtures/qa-admin/bom-mamposteria.json"), "utf8"));
const out = path.join(root, "..", "qa-e2e-administracion/remediation-1/fixtures", runDate);
fs.mkdirSync(out, { recursive: true });
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bom.materials.map(m => ({ PARTIDA_CODIGO: bom.itemCode, PRODUCTO_CODIGO: m.sku, CANTIDAD: m.quantityPerUnit, DESPERDICIO_PCT: m.wastePct }))), "BOM_Materiales");
fs.writeFileSync(path.join(out, "QA_BOM_Mamposteria.xlsx"), XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
const climate = {
  runDate, dates, periodStart: dates.LL, periodEnd: dates.B,
  rainfallMm: 35,
  location: { name: "Asunción — punto sintético QA, no ubicación de una obra real", latitude: -25.3, longitude: -57.6 },
  parameters: {
    schemaVersion: 1, label: "PBC-QA-CLIMA-RELATIVO", documentRef: "Fixture QA, sin validez contractual", clauseRef: "QA-1",
    effectiveFrom: dates.LL, startDate: dates.LL, baseDays: 120, dayBasis: "CALENDAR", includeStart: true,
    workingWeekdays: [], holidays: [], thresholdMm: 20, thresholdOperator: "GT", rainSource: "EITHER",
    sourceName: "DMH_DINAC", stationId: "", eligibleCodes: ["LL", "HH"], otherReasons: [],
    requireEvidence: true, requireCausality: true, requireImpediment: false, requireConformity: false,
    toleranceDays: 2, toleranceScope: "MONTH", partialMonth: "FULL", capMode: "NONE", monthlyCap: null, totalCap: null,
    rounding: "FLOOR", formula: "EXCESS_ELIGIBLE_DAYS_V1", unsupportedClause: "",
  },
  expected: "Two eligible LL/HH days, zero extension after tolerance; B excludes. Human decisions required. Do not create an official extension.",
  guard: "Confirm all dates are inside project dates and no later than the ERP historical cutoff. If not, regenerate with the actual cutoff as runDate.",
};
fs.writeFileSync(path.join(out, "QA_Clima_Relativo.json"), JSON.stringify(climate, null, 2));
fs.writeFileSync(path.join(out, "LEEME.md"), `# Variante de fixtures QA — ${runDate}

Los originales y las corridas cerradas permanecen intactos. No se ejecutaron pasos QA.

## BOM
En Presupuesto → APU de partida 03 → Materiales, importar QA_BOM_Mamposteria.xlsx y revisar los tres SKU existentes. Cantidad es material por m² ejecutado, desperdicio 0 %. Configurar la partida como REQUIRES_BOM si corresponde en la UI. Son ratios sintéticos de prueba, no una especificación técnica de obra.
Meta 100 m², Clima OFF, stock de obra 0, central sin reservas: bruto 25 bolsas / 4.000 un / 2 m³; compras netas 0 bolsas / 2.000 un / 0 m³. Si hay reservas o ejecuciones previas, registrar el output real. La RFQ manual 60/3.000 sigue como alternativa del Master; no afirmar que deriva de este BOM.

## Clima
Fechas pasadas: LL ${dates.LL}, HH ${dates.HH}, B ${dates.B}. Cálculo ${dates.LL}–${dates.B}. Verificar fechas contractuales y corte histórico antes de operar. Usar QA_Clima_Relativo.json como parámetros explícitos sintéticos.
En el portal de residente usar la cámara real y fotografiar el soporte QA de medición 35 mm; no presentar esta imagen como una observación meteorológica real. Si el dispositivo realmente no dispone de cámara o falla su apertura, el componente existente ofrece Subir foto: ese fallback admite el PNG QA y registra source=archivo. No simular un fallo para forzar el fallback ni incorporar nuevos controles. El residente aporta evidencia/propuesta, el admin confirma LL y crea HH por efecto de aquella lluvia, manteniendo relación causal; confirma B aparte. Revisar evidencia separada del Libro final.
La ubicación QA es Asunción (-25.3, -57.6), escogida explícitamente para probar selección de estación. No pertenece a la obra real. La observación externa puede ser inferior a 20 mm: no alterar resultados ni afirmar lluvia externa de 35 mm. Con EITHER, la medición local QA >20 sirve para la elegibilidad. La evaluación automática puede quedar propuesta pendiente, nunca decisión final.
Con dos días elegibles y tolerancia mensual completa de 2, la prórroga computable esperada es 0; no cambiar tolerancia para forzar días adicionales. Registrar faltantes de evidencia o vínculo causal si el motor los señala.
`);
console.log(out);
