/**
 * Verifica que las migraciones BIM 0071–0073 estén aplicadas en la DB objetivo
 * (en CI: Supabase local efímero tras `supabase db reset`).
 *
 * Comprueba existencia de tablas/columnas/bucket (prueba funcional de que la
 * migración corrió) y, a modo informativo, el historial de migraciones.
 *
 * Env: TEST_DATABASE_URL (o DATABASE_URL). Nunca loguea la connection string.
 */

import { Client } from "pg";

async function tableExists(client: Client, table: string): Promise<boolean> {
  const { rows } = await client.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1",
    [table]
  );
  return rows.length > 0;
}

async function columnExists(client: Client, table: string, column: string): Promise<boolean> {
  const { rows } = await client.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2",
    [table, column]
  );
  return rows.length > 0;
}

async function run(): Promise<void> {
  const dbUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("❌ [bim-e2e-verify] Falta TEST_DATABASE_URL (o DATABASE_URL).");
    process.exit(1);
  }
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    const requiredTables = [
      "bim_models",
      "bim_elements",
      "bim_budget_matches",
      "bim_element_groups",
      "bim_group_matches",
    ];
    let failed = false;
    for (const t of requiredTables) {
      const ok = await tableExists(client, t);
      console.log(`${ok ? "✅" : "❌"} [bim-e2e-verify] tabla public.${t} ${ok ? "existe" : "FALTA"}`);
      if (!ok) failed = true;
    }

    const requiredColumns: Array<[string, string]> = [
      ["bim_elements", "express_id"],
      ["bim_elements", "group_id"],
      ["bim_elements", "ifc_guid"],
      ["bim_element_groups", "total_quantity"],
      ["bim_group_matches", "status"],
    ];
    for (const [t, c] of requiredColumns) {
      const ok = await columnExists(client, t, c);
      console.log(`${ok ? "✅" : "❌"} [bim-e2e-verify] columna ${t}.${c} ${ok ? "existe" : "FALTA"}`);
      if (!ok) failed = true;
    }

    const { rows: bucketRows } = await client.query(
      "SELECT 1 FROM storage.buckets WHERE id='bim-models'"
    );
    const bucketOk = bucketRows.length > 0;
    console.log(`${bucketOk ? "✅" : "❌"} [bim-e2e-verify] bucket storage 'bim-models' ${bucketOk ? "existe" : "FALTA"}`);
    if (!bucketOk) failed = true;

    // Historial de migraciones (informativo: no falla si la tabla interna cambia de nombre).
    try {
      const { rows } = await client.query(
        "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version"
      );
      const versions = rows.map((r) => String(r.version));
      for (const v of ["0071", "0072", "0073"]) {
        const found = versions.some((ver) => ver.includes(v));
        console.log(`${found ? "✅" : "⚠️"} [bim-e2e-verify] migración ${v} ${found ? "en historial" : "NO figura en historial (verificar por tablas)"}`);
      }
    } catch {
      console.log("⚠️ [bim-e2e-verify] no se pudo leer supabase_migrations.schema_migrations (informativo)");
    }

    if (failed) {
      console.error("❌ [bim-e2e-verify] FALTAN objetos BIM 0071–0073. Abortando certificación.");
      process.exit(1);
    }
    console.log("✅ [bim-e2e-verify] migraciones BIM 0071–0073 verificadas");
  } finally {
    await client.end();
  }
}

void run();
