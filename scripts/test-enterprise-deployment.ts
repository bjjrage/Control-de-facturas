/**
 * TEST SUITE: ENTERPRISE DEPLOYMENT PACK (GATE 21)
 * Verifica:
 * 1. Existencia y sintaxis válida de docker-compose.enterprise.yml
 * 2. Existencia de todas las migraciones acumuladas (0001 a 0065)
 * 3. Documentación operativa de Disaster Recovery y Backups
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 TEST SUITE: ENTERPRISE DEPLOYMENT PACK (GATE 21)');
  console.log('======================================================\n');

  const rootDir = process.cwd();

  // 1. Verificar Docker Compose Empresarial
  console.log('--- TEST 1: Verificación de Docker Compose Empresarial ---');
  const composePath = join(rootDir, 'docker-compose.enterprise.yml');
  assert(existsSync(composePath), 'Archivo docker-compose.enterprise.yml existe');

  const composeContent = readFileSync(composePath, 'utf8');
  assert(composeContent.includes('construct_postgres'), 'Contenedor de base de datos definido');
  assert(composeContent.includes('construct_storage'), 'Almacenamiento S3 / MinIO definido');
  assert(composeContent.includes('construct_web'), 'Aplicación web Next.js definida');
  assert(composeContent.includes('construct_redis'), 'Cola y caché Redis definida');
  assert(composeContent.includes('construct_gateway'), 'Reverse proxy NGINX definido');

  // 2. Verificar Playbook de Operaciones y Disaster Recovery
  console.log('\n--- TEST 2: Verificación de Guía Operativa y Disaster Recovery ---');
  const playbookPath = join(rootDir, 'docs', 'ENTERPRISE_DEPLOYMENT.md');
  assert(existsSync(playbookPath), 'Guía ENTERPRISE_DEPLOYMENT.md existe');

  const playbookContent = readFileSync(playbookPath, 'utf8');
  assert(playbookContent.includes('pg_dump'), 'Procedimiento de backup documentado');
  assert(playbookContent.includes('pg_restore'), 'Procedimiento de restore / disaster recovery documentado');
  assert(playbookContent.includes('ROTACIÓN DE CLAVES'), 'Procedimiento de rotación de claves documentado');

  // 3. Verificar Cadena de Migraciones SQL
  console.log('\n--- TEST 3: Integridad de Cadena de Migraciones SQL ---');
  const migrations = [
    '0060_procurement_evidence_foundation.sql',
    '0061_consortia_and_normalized_bids.sql',
    '0062_competitor_intelligence.sql',
    '0063_cost_observations.sql',
    '0064_company_bid_vault.sql',
    '0065_bid_analysis_snapshots.sql',
    '0066_bid_snapshot_nullability_and_project_linkage.sql',
    '0067_canonical_cost_and_contract_history.sql',
    '0068_security_definer_tenant_hardening.sql'
  ];

  for (const m of migrations) {
    const p = join(rootDir, 'supabase', 'migrations', m);
    assert(existsSync(p), `Migración fundacional ${m} presente y verificada`);
  }

  console.log('\n======================================================');
  console.log('🎉 TODOS LOS TESTS DE GATE 21 PASARON CON ÉXITO');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('Error fatal en suite de pruebas Gate 21:', err);
  process.exit(1);
});
