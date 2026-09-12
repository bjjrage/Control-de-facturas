/**
 * Seed mínimo y reproducible para el workflow manual "BIM E2E Certification".
 *
 * Crea EXCLUSIVAMENTE en la DB a la que apunte el entorno (en CI: Supabase
 * local efímero):
 *   - usuario de test local (Auth Admin API, email confirmado)
 *   - empresa "Demo BIM Aurora" (plan caterpillar: habilita tab BIM)
 *   - profile admin vinculado a esa empresa
 *   - proyecto "Proyecto Demo — Edificio Aurora" (código AURORA-DEMO)
 *
 * NO crea budget_items (el catálogo entra por el importador Excel REAL desde
 * la UI de Playwright) y NO inserta nada de bim_* (el IFC entra por la UI).
 * Idempotente: si el usuario/empresa/proyecto ya existen, los reutiliza (y
 * deja el password determinístico del entorno).
 *
 * Env requerida (nunca loguea secretos):
 *   BIM_SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL)
 *   BIM_SERVICE_ROLE_KEY (o SUPABASE_SERVICE_ROLE_KEY)
 *   BIM_TEST_EMAIL, BIM_TEST_PASSWORD
 *   BIM_PROJECT_CODE (opcional, default AURORA-DEMO)
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.BIM_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.BIM_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_EMAIL = process.env.BIM_TEST_EMAIL;
const TEST_PASSWORD = process.env.BIM_TEST_PASSWORD;
const PROJECT_CODE = process.env.BIM_PROJECT_CODE ?? "AURORA-DEMO";

const PROD_REF = "ezucivipgmbvamhugkbj";

function fail(msg: string): never {
  console.error(`❌ [bim-e2e-seed] ${msg}`);
  process.exit(1);
}

if (!SUPABASE_URL) fail("Falta BIM_SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL).");
if (!SERVICE_ROLE_KEY) fail("Falta BIM_SERVICE_ROLE_KEY (o SUPABASE_SERVICE_ROLE_KEY).");
if (!TEST_EMAIL) fail("Falta BIM_TEST_EMAIL.");
if (!TEST_PASSWORD) fail("Falta BIM_TEST_PASSWORD.");
if (SUPABASE_URL.includes(PROD_REF)) {
  fail(`La URL apunta al proyecto productivo (${PROD_REF}). Abortando por seguridad.`);
}

async function run(): Promise<void> {
  const admin = createClient(SUPABASE_URL as string, SERVICE_ROLE_KEY as string, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1) Usuario de test (buscar por email, crear o fijar password).
  const { data: listed, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listError) fail(`No se pudo listar usuarios: ${listError.message}`);
  let userId = listed.users.find((u) => u.email?.toLowerCase() === (TEST_EMAIL as string).toLowerCase())?.id;

  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email: TEST_EMAIL as string,
      password: TEST_PASSWORD as string,
      email_confirm: true,
      user_metadata: { full_name: "BIM E2E Tester" },
    });
    if (error || !data.user) fail(`No se pudo crear el usuario de test: ${error?.message}`);
    userId = data.user.id;
    console.log(`✅ [bim-e2e-seed] usuario creado: ${TEST_EMAIL}`);
  } else {
    const { error } = await admin.auth.admin.updateUserById(userId, {
      password: TEST_PASSWORD as string,
      email_confirm: true,
    });
    if (error) fail(`No se pudo fijar el password del usuario existente: ${error.message}`);
    console.log(`✅ [bim-e2e-seed] usuario existente reutilizado: ${TEST_EMAIL}`);
  }

  // 2) Empresa demo (plan caterpillar: exige requirePlan("pro") y muestra el tab BIM).
  const { data: existingEmpresa } = await admin
    .from("empresas")
    .select("id")
    .eq("slug", "demo-bim-aurora")
    .maybeSingle();
  let empresaId = existingEmpresa?.id as string | undefined;
  if (!empresaId) {
    const { data, error } = await admin
      .from("empresas")
      .insert({ nombre: "Demo BIM Aurora", slug: "demo-bim-aurora", plan: "caterpillar" })
      .select("id")
      .single();
    if (error || !data) fail(`No se pudo crear la empresa demo: ${error?.message}`);
    empresaId = data.id as string;
    console.log("✅ [bim-e2e-seed] empresa creada: Demo BIM Aurora (caterpillar)");
  } else {
    await admin.from("empresas").update({ plan: "caterpillar" }).eq("id", empresaId);
    console.log("✅ [bim-e2e-seed] empresa existente reutilizada (plan=caterpillar)");
  }

  // 3) Profile admin del usuario en esa empresa.
  const { error: profileError } = await admin.from("profiles").upsert(
    {
      id: userId,
      email: TEST_EMAIL as string,
      full_name: "BIM E2E Tester",
      role: "admin",
      empresa_id: empresaId,
    },
    { onConflict: "id" }
  );
  if (profileError) fail(`No se pudo crear el profile: ${profileError.message}`);
  console.log("✅ [bim-e2e-seed] profile admin vinculado a la empresa");

  // 4) Proyecto demo (vacío: presupuesto entra por Excel vía UI, BIM vía UI).
  const { data: existingProject } = await admin
    .from("projects")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("code", PROJECT_CODE)
    .maybeSingle();
  let projectId = existingProject?.id as string | undefined;
  if (!projectId) {
    const { data, error } = await admin
      .from("projects")
      .insert({
        empresa_id: empresaId,
        name: "Proyecto Demo — Edificio Aurora",
        code: PROJECT_CODE,
        client: "Cliente Demo",
        status: "ACTIVO",
        created_by: userId,
      })
      .select("id")
      .single();
    if (error || !data) fail(`No se pudo crear el proyecto demo: ${error?.message}`);
    projectId = data.id as string;
    console.log(`✅ [bim-e2e-seed] proyecto creado: AURORA-DEMO (${projectId})`);
  } else {
    console.log(`✅ [bim-e2e-seed] proyecto existente reutilizado: AURORA-DEMO (${projectId})`);
  }

  console.log(
    JSON.stringify({ ok: true, email: TEST_EMAIL, empresa_id: empresaId, project_id: projectId })
  );
}

void run();
