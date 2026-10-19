/* Read-only sales document access check through the final local build.
 * Temporary auth users and one empty company are removed in finally.
 */
require("dotenv").config({ path: ".env.local" });
const assert = require("node:assert/strict");
const { randomUUID, randomBytes } = require("node:crypto");
const { spawn } = require("node:child_process");
const { createClient } = require("@supabase/supabase-js");
const { chromium } = require("@playwright/test");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
assert.equal(new URL(url).hostname, "kyiihlkncatojvlasoag.supabase.co", "isolated preview required");
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const origin = "http://127.0.0.1:3017";
const runId = randomUUID().slice(0, 8);
const password = `Qa!${randomBytes(18).toString("base64url")}`;
const users = [];
let companyB = null;
let centralB = null;
let clientB = null;
let server = null;
let browser = null;

function check(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function createUser(companyId, suffix) {
  const email = `qa-merge-${runId}-${suffix}@example.com`;
  const auth = check(await admin.auth.admin.createUser({ email, password, email_confirm: true }), "create QA auth user");
  assert.ok(auth.user);
  users.push(auth.user.id);
  check(await admin.from("profiles").insert({
    id: auth.user.id, email, full_name: `QA merge ${suffix}`,
    role: "admin", active: true, empresa_id: companyId,
  }), "create QA profile");
  return email;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw new Error("Local build exited before ready");
    try {
      const response = await fetch(`${origin}/login`, { signal: AbortSignal.timeout(3000) });
      if (response.ok) return;
    } catch { /* Next may still be starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Local build did not become ready");
}

async function login(page, email) {
  await page.goto(`${origin}/login`);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /Ingresar/i }).click();
  await page.waitForURL(/\/dashboard(?:\?|$)/, { timeout: 20000 });
}

async function main() {
  const profiles = check(await admin.from("profiles").select("empresa_id").eq("active", true).limit(1), "select existing company");
  assert.equal(profiles.length, 1, "existing company required");
  const companyA = profiles[0].empresa_id;
  const documents = check(await admin.from("sales_documents")
    .select("id,code").eq("empresa_id", companyA).order("created_at", { ascending: false }).limit(1), "select sales document");
  assert.equal(documents.length, 1, "existing sales document required");
  const document = documents[0];

  companyB = check(await admin.from("empresas").insert({
    nombre: `QA isolated tenant ${runId}`, slug: `qa-isolated-${runId}`,
    plan: "caterpillar", modulo_compras: true, modulo_ventas: true,
  }).select("id").single(), "create isolated QA tenant").id;
  const emailA = await createUser(companyA, "a");
  const emailB = await createUser(companyB, "b");
  centralB = check(await admin.from("inventory_locations").insert({
    empresa_id: companyB, location_type: "CENTRAL", name: "QA central warehouse",
    is_primary: true, active: true, created_by: users[1],
  }).select("id").single(), "create temporary central location").id;
  clientB = check(await admin.from("clients").insert({
    empresa_id: companyB, name: `QA merge client ${runId}`, active: true,
  }).select("id").single(), "create temporary sales client").id;

  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3017"], {
    cwd: process.cwd(), env: process.env, windowsHide: true,
    stdio: "ignore",
  });
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  await login(pageA, emailA);
  const ownResponse = await pageA.goto(`${origin}/ventas/${document.id}`);
  assert.equal(ownResponse?.status(), 200, "own sales detail must load");
  assert.equal(await pageA.getByRole("heading", { name: document.code, exact: true }).count(), 1);

  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await login(pageB, emailB);
  const crossResponse = await pageB.goto(`${origin}/ventas/${document.id}`);
  assert.ok([200, 404].includes(crossResponse?.status()), "cross-company route must respond");
  assert.equal(await pageB.getByRole("heading", { name: document.code, exact: true }).count(), 0);
  assert.ok(!(await pageB.locator("body").innerText()).includes(document.code),
    "cross-company page must not disclose the sales document code");

  const adversary = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } });
  check(await adversary.auth.signInWithPassword({ email: emailB, password }), "login adversary API");
  const query = check(await adversary.from("sales_documents").select("id")
    .eq("id", document.id).maybeSingle(), "cross-company RLS read");
  assert.equal(query, null, "cross-company API read must return no row");
  const ownCentral = check(await adversary.from("inventory_locations").select("id")
    .eq("id", centralB).maybeSingle(), "own central RLS read");
  assert.equal(ownCentral?.id, centralB, "QA user must see own central location");

  await pageB.goto(`${origin}/rfqs?nueva=1`);
  await pageB.locator("#purchase-destination").click({ timeout: 15000 });
  const centralOption = pageB.getByRole("option", { name: /QA central warehouse/ });
  await centralOption.waitFor({ timeout: 15000 });
  await centralOption.click();
  assert.ok((await pageB.locator("#purchase-destination").innerText()).includes("QA central warehouse"),
    "central destination must be selected in RFQ UI");

  await pageB.goto(`${origin}/ventas/nueva`);
  await pageB.locator("#client_id").click();
  await pageB.getByRole("option", { name: `QA merge client ${runId}` }).click();
  await pageB.locator("#doc_type").click();
  await pageB.getByRole("option", { name: "Factura", exact: true }).click();
  await pageB.getByText("Descripción", { exact: true }).locator("..").locator("input").fill("QA merge line");
  await pageB.getByText("Cant.", { exact: true }).locator("..").locator("input").fill("2");
  await pageB.getByText("Precio unit.", { exact: true }).locator("..").locator("input").fill("1000");
  await pageB.getByRole("button", { name: "Crear borrador" }).click();
  await pageB.waitForURL(/\/ventas\/[0-9a-f-]{36}$/, { timeout: 20000 });
  const documentB = pageB.url().split("/").at(-1);
  let lines = check(await admin.from("sales_document_items").select("description,quantity,unit_price")
    .eq("sales_document_id", documentB).eq("empresa_id", companyB), "read created sale lines");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].description, "QA merge line");

  await pageB.goto(`${origin}/ventas/${documentB}/editar`);
  await pageB.getByText("Descripción", { exact: true }).locator("..").locator("input").fill("QA merge updated line");
  await pageB.getByRole("button", { name: "Guardar cambios" }).click();
  await pageB.waitForURL(new RegExp(`/ventas/${documentB}$`), { timeout: 20000 });
  lines = check(await admin.from("sales_document_items").select("description,quantity,unit_price")
    .eq("sales_document_id", documentB).eq("empresa_id", companyB), "read updated sale lines");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].description, "QA merge updated line");
  console.log(`PASS: final build, sales create/edit atomic, own sale 200, cross-tenant sale hidden (HTTP ${crossResponse.status()}), RLS empty, central destination visible`);
}

async function cleanup() {
  const cleanupError = (label, error) => {
    console.error(`${label}: ${error.message}`);
    process.exitCode = 1;
  };
  if (browser) await browser.close().catch(() => {});
  if (server && server.exitCode === null) server.kill();
  if (companyB) {
    const result = await admin.from("sales_documents").delete().eq("empresa_id", companyB);
    if (result.error) cleanupError("QA sale cleanup failed", result.error);
  }
  if (clientB) {
    const result = await admin.from("clients").delete().eq("id", clientB).eq("empresa_id", companyB);
    if (result.error) cleanupError("QA client cleanup failed", result.error);
  }
  if (centralB) {
    const result = await admin.from("inventory_locations").delete().eq("id", centralB);
    if (result.error) cleanupError("QA location cleanup failed", result.error);
  }
  for (const id of users.reverse()) {
    const result = await admin.auth.admin.deleteUser(id);
    if (result.error) cleanupError("QA user cleanup failed", result.error);
  }
  if (companyB) {
    const counters = await admin.from("sales_counters").delete().eq("empresa_id", companyB);
    if (counters.error) cleanupError("QA counter cleanup failed", counters.error);
    const result = await admin.from("empresas").delete().eq("id", companyB);
    if (result.error) cleanupError("QA company cleanup failed", result.error);
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; })
  .finally(cleanup);
