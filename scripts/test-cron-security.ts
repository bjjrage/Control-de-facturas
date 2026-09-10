/**
 * TEST SUITE: CRON SECURITY (P0 FAIL-CLOSED)
 * Valida:
 * 1. Falla cerrado con 500 si CRON_SECRET no está configurado en el entorno
 * 2. Rechaza 401 si no hay encabezado Authorization Bearer
 * 3. Rechaza 401 si el secret viene por query parameter (?key= o ?secret=)
 * 4. Rechaza 401 si el Bearer token es incorrecto
 * 5. Acepta y valida cuando el Bearer token es legítimo
 */

import { NextRequest } from "next/server";
import { GET, POST } from "../app/api/cron/tender-monitoring/route";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

async function runTests() {
  console.log("\n======================================================");
  console.log("🔒 TEST SUITE: CRON ENDPOINT SECURITY & FAIL-CLOSED (P0)");
  console.log("======================================================\n");

  const originalSecret = process.env.CRON_SECRET;

  // CASO 1: CRON_SECRET ausente en el servidor -> 500 Fail-Closed
  console.log("--- TEST 1: CRON_SECRET Ausente en Servidor (Fail-Closed) ---");
  delete process.env.CRON_SECRET;

  const reqNoSecret = new NextRequest("http://localhost:3000/api/cron/tender-monitoring", {
    headers: { authorization: "Bearer cualquier-token" }
  });
  const resNoSecret = await GET(reqNoSecret);
  assert(resNoSecret.status === 500, `Responde status 500 (obtenido: ${resNoSecret.status})`);
  const bodyNoSecret = await resNoSecret.json();
  assert(bodyNoSecret.error.includes("CRON_SECRET ausente"), `Mensaje de error explícito de configuración`);

  // Configurar secret de prueba para los siguientes casos
  const TEST_SECRET = "cron_ultra_secure_secret_2026_xyz";
  process.env.CRON_SECRET = TEST_SECRET;

  // CASO 2: Sin encabezado Authorization -> 401
  console.log("\n--- TEST 2: Solicitud Sin Encabezado Authorization ---");
  const reqNoAuth = new NextRequest("http://localhost:3000/api/cron/tender-monitoring");
  const resNoAuth = await GET(reqNoAuth);
  assert(resNoAuth.status === 401, `Responde status 401 (obtenido: ${resNoAuth.status})`);

  // CASO 3: Intento de pasar secret por Query Parameter -> Rechazado 401
  console.log("\n--- TEST 3: Secret Pasado por Query Parameter (?key=) ---");
  const reqQueryKey = new NextRequest(`http://localhost:3000/api/cron/tender-monitoring?key=${TEST_SECRET}`);
  const resQueryKey = await GET(reqQueryKey);
  assert(resQueryKey.status === 401, `Rechaza credenciales en query param con 401 (obtenido: ${resQueryKey.status})`);

  // CASO 4: Token Bearer Incorrecto -> 401
  console.log("\n--- TEST 4: Token Bearer Incorrecto ---");
  const reqWrongToken = new NextRequest("http://localhost:3000/api/cron/tender-monitoring", {
    headers: { authorization: "Bearer secret_falso_123" }
  });
  const resWrongToken = await GET(reqWrongToken);
  assert(resWrongToken.status === 401, `Rechaza token falso con 401 (obtenido: ${resWrongToken.status})`);

  // CASO 5: Token Bearer Válido -> Autenticación Exitosa
  console.log("\n--- TEST 5: Token Bearer Válido (Autorizado) ---");
  const reqValid = new NextRequest("http://localhost:3000/api/cron/tender-monitoring?dry_run=true&limit=1", {
    headers: { authorization: `Bearer ${TEST_SECRET}` }
  });
  const resValid = await GET(reqValid);
  // Puede responder 200 (si corre o simula) o 500 si Supabase no está conectado localmente,
  // pero NO debe responder 401 ni error de autenticación.
  assert(resValid.status !== 401, `Autenticación superada con éxito (status obtenido: ${resValid.status})`);
  console.log(`Endpoint aceptó el token Bearer correctamente (status: ${resValid.status})`);

  // Restaurar entorno
  if (originalSecret) {
    process.env.CRON_SECRET = originalSecret;
  } else {
    delete process.env.CRON_SECRET;
  }

  console.log("\n======================================================");
  console.log("🎉 TODOS LOS TESTS DE CRON SECURITY PASARON CON ÉXITO");
  console.log("======================================================\n");
}

runTests().catch(err => {
  console.error("Error fatal en tests de cron security:", err);
  process.exit(1);
});