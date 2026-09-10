/**
 * GATE 3: VERIFICACIÓN DE COBERTURA HISTÓRICA (2015 → 2026)
 * 
 * Audita cuantitativamente el volumen, distribución temporal y completitud
 * del warehouse de contrataciones públicas históricas.
 * 
 * Invariante de cobertura:
 * El rango objetivo canónico es 2015-2026. Cualquier año con 0 registros
 * constituye un GAP explícito, determinando un estado 'PARTIAL / COVERAGE_UNKNOWN'.
 */

import * as fs from "node:fs";
import * as path from "node:path";

interface CheckpointData {
  wave: number;
  last_processed_id: number;
  total_processed: number;
  total_identified_construction?: number;
  total_ingested_construction?: number;
  total_file_saved?: number;
  total_db_persisted?: number;
  errors_count: number;
  by_year: Record<string, number>;
  by_category: Record<string, number>;
  top_buyers: Record<string, number>;
  start_time: string;
  last_updated_at: string;
}

const CHECKPOINT_PATH = path.resolve(process.cwd(), "data", "backfill-checkpoint.json");
const BACKFILL_DIR = path.resolve(process.cwd(), "data", "backfill");

// Rango canónico objetivo obligatorio para backfill DNCP
export const TARGET_COVERAGE_YEARS = [
  "2015", "2016", "2017", "2018", "2019",
  "2020", "2021", "2022", "2023", "2024",
  "2025", "2026"
];

export function auditHistoricalCoverage(byYearData: Record<string, number>, totalIdentified: number) {
  const gapYears: string[] = [];
  const coveredYears: string[] = [];

  for (const yr of TARGET_COVERAGE_YEARS) {
    const count = byYearData[yr] || 0;
    if (count === 0) {
      gapYears.push(yr);
    } else {
      coveredYears.push(yr);
    }
  }

  const isComplete = gapYears.length === 0 && totalIdentified > 0;
  const status = isComplete ? "FULL / VERIFIED" : "PARTIAL / COVERAGE_UNKNOWN";

  return {
    targetYears: TARGET_COVERAGE_YEARS,
    coveredYears,
    gapYears,
    isComplete,
    status
  };
}

async function verifyCoverage() {
  console.log("================================================================================");
  console.log("GATE 3: REPORTE DE AUDITORÍA DE COBERTURA HISTÓRICA (2015 → 2026)");
  console.log("================================================================================\n");

  if (!fs.existsSync(CHECKPOINT_PATH)) {
    console.error("No se encontró archivo de checkpoint en:", CHECKPOINT_PATH);
    console.log("\nESTADO DE COBERTURA: PARTIAL / COVERAGE_UNKNOWN ⚠️");
    console.log("VEREDICTO GATE 3: SIN ARCHIVO DE CHECKPOINT — COBERTURA NO INICIADA");
    process.exit(1);
  }

  const cp: CheckpointData = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, "utf8"));
  const totalIdentified = cp.total_identified_construction ?? cp.total_ingested_construction ?? 0;

  console.log(`[Resumen General del Backfill - Ola ${cp.wave}]`);
  console.log(`- Licitaciones totales inspeccionadas: ${cp.total_processed}`);
  console.log(`- Licitaciones de obras/construcción identificadas: ${totalIdentified}`);
  console.log(`- Tasa de errores / caídas de red: ${cp.errors_count} (${((cp.errors_count / Math.max(1, cp.total_processed)) * 100).toFixed(1)}%)`);
  console.log(`- Fecha de inicio: ${cp.start_time}`);
  console.log(`- Última sincronización registrada: ${cp.last_updated_at}\n`);

  // 1. Distribución Temporal en el Rango Objetivo (2015-2026)
  console.log("--- 1. Cobertura Temporal por Año (Rango Objetivo 2015 - 2026) ---");
  const audit = auditHistoricalCoverage(cp.by_year || {}, totalIdentified);

  console.log("| Año | Licitaciones de Obra Identificadas | Proporción | Estado de Cobertura |");
  console.log("| :---: | :---: | :---: | :---: |");

  for (const yr of audit.targetYears) {
    const count = (cp.by_year && cp.by_year[yr]) || 0;
    const pct = ((count / Math.max(1, totalIdentified)) * 100).toFixed(1);
    const status = count > 0 ? "COBERTURA ACTIVA ✓" : "HUECO TEMPORAL (GAP) ✗";
    console.log(`| ${yr} | ${count} | ${pct}% | ${status} |`);
  }

  // 2. Distribución por Categoría de Construcción
  console.log("\n--- 2. Distribución por Categoría ---");
  const categories = Object.entries(cp.by_category || {}).sort((a, b) => b[1] - a[1]);
  for (const [cat, count] of categories.slice(0, 10)) {
    const pct = ((count / Math.max(1, totalIdentified)) * 100).toFixed(1);
    console.log(`  • ${cat}: ${count} (${pct}%)`);
  }

  // 3. Top Convocantes (Entidades Públicas Compradoras)
  console.log("\n--- 3. Principales Convocantes Representados ---");
  const buyers = Object.entries(cp.top_buyers || {}).sort((a, b) => b[1] - a[1]);
  for (const [buyer, count] of buyers.slice(0, 10)) {
    console.log(`  • ${buyer}: ${count} licitaciones`);
  }

  // 4. Verificación de Archivos Físicos en Warehouse
  console.log("\n--- 4. Integridad del Warehouse Local (data/backfill/) ---");
  if (fs.existsSync(BACKFILL_DIR)) {
    const yearDirs = fs.readdirSync(BACKFILL_DIR).filter((d) => fs.statSync(path.join(BACKFILL_DIR, d)).isDirectory());
    let totalFiles = 0;
    for (const yd of yearDirs) {
      const files = fs.readdirSync(path.join(BACKFILL_DIR, yd)).filter((f) => f.endsWith(".json"));
      totalFiles += files.length;
      console.log(`  📁 Año ${yd}: ${files.length} archivos JSON crudos almacenados`);
    }
    console.log(`  Total archivos físicos indexados: ${totalFiles}`);
  }

  console.log("\n================================================================================");
  console.log(`ESTADO DE COBERTURA: ${audit.status}`);
  if (audit.isComplete) {
    console.log("VEREDICTO GATE 3: COBERTURA HISTÓRICA COMPLETA Y VERIFICADA (2015-2026) ✅");
  } else {
    console.log(`VEREDICTO GATE 3: COBERTURA PARCIAL CON GAPS IDENTIFICADOS (${audit.gapYears.length} años sin datos: ${audit.gapYears.join(", ")}) ⚠️`);
  }
  console.log("================================================================================\n");
}

const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('verify-historical-coverage.ts') || 
  process.argv[1].endsWith('verify-historical-coverage.js')
);

if (isDirectRun) {
  verifyCoverage().catch(console.error);
}

