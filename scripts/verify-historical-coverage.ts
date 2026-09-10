/**
 * GATE 3: VERIFICACIÓN DE COBERTURA HISTÓRICA
 * 
 * Audita cuantitativamente el volumen, distribución temporal y completitud
 * del warehouse de contrataciones públicas históricas.
 */

import * as fs from "node:fs";
import * as path from "node:path";

interface CheckpointData {
  wave: number;
  last_processed_id: number;
  total_processed: number;
  total_ingested_construction: number;
  errors_count: number;
  by_year: Record<string, number>;
  by_category: Record<string, number>;
  top_buyers: Record<string, number>;
  start_time: string;
  last_updated_at: string;
}

const CHECKPOINT_PATH = path.resolve(process.cwd(), "data", "backfill-checkpoint.json");
const BACKFILL_DIR = path.resolve(process.cwd(), "data", "backfill");

async function verifyCoverage() {
  console.log("================================================================================");
  console.log("GATE 3: REPORTE DE AUDITORÍA DE COBERTURA HISTÓRICA (2020 → PRESENTE)");
  console.log("================================================================================\n");

  if (!fs.existsSync(CHECKPOINT_PATH)) {
    console.error("No se encontró archivo de checkpoint en:", CHECKPOINT_PATH);
    process.exit(1);
  }

  const cp: CheckpointData = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, "utf8"));

  console.log(`[Resumen General del Backfill - Ola ${cp.wave}]`);
  console.log(`- Licitaciones totales inspeccionadas: ${cp.total_processed}`);
  console.log(`- Licitaciones de obras/construcción retenidas: ${cp.total_ingested_construction}`);
  console.log(`- Tasa de errores / caídas de red: ${cp.errors_count} (${((cp.errors_count / Math.max(1, cp.total_processed)) * 100).toFixed(1)}%)`);
  console.log(`- Fecha de inicio: ${cp.start_time}`);
  console.log(`- Última sincronización registrada: ${cp.last_updated_at}\n`);

  // 1. Distribución Temporal por Año
  console.log("--- 1. Cobertura Temporal por Año ---");
  const years = Object.keys(cp.by_year).sort();
  let hasTemporalGaps = false;
  
  console.log("| Año | Licitaciones de Obra Ingestadas | Proporción | Estado de Cobertura |");
  console.log("| :---: | :---: | :---: | :---: |");

  for (const yr of years) {
    const count = cp.by_year[yr];
    const pct = ((count / Math.max(1, cp.total_ingested_construction)) * 100).toFixed(1);
    const status = count > 0 ? "COBERTURA ACTIVA ✓" : "HUECO TEMPORAL ✗";
    if (count === 0) hasTemporalGaps = true;
    console.log(`| ${yr} | ${count} | ${pct}% | ${status} |`);
  }

  // 2. Distribución por Categoría de Construcción
  console.log("\n--- 2. Distribución por Categoría ---");
  const categories = Object.entries(cp.by_category).sort((a, b) => b[1] - a[1]);
  for (const [cat, count] of categories.slice(0, 10)) {
    const pct = ((count / Math.max(1, cp.total_ingested_construction)) * 100).toFixed(1);
    console.log(`  • ${cat}: ${count} (${pct}%)`);
  }

  // 3. Top Convocantes (Entidades Públicas Compradoras)
  console.log("\n--- 3. Principales Convocantes Representados ---");
  const buyers = Object.entries(cp.top_buyers).sort((a, b) => b[1] - a[1]);
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
  if (!hasTemporalGaps && cp.total_ingested_construction > 0) {
    console.log("VEREDICTO GATE 3: COBERTURA HISTÓRICA VERIFICADA SIN HUECOS TEMPORALES ✅");
  } else {
    console.log("VEREDICTO GATE 3: REQUIERE MAYOR INGESTA O PRESENTÓ HUECOS TEMPORALES ⚠️");
  }
  console.log("================================================================================\n");
}

verifyCoverage().catch(console.error);
