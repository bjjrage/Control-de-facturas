import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parse } from "dotenv";

// These fixtures belong solely to this run. Never point this suite at production.
const env = parse(readFileSync(".env.local"));
if (env.NEXT_PUBLIC_SUPABASE_URL !== "https://kyiihlkncatojvlasoag.supabase.co") throw Error("QA target required");
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const client = () => createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const run = randomUUID().slice(0, 8);
const companies: string[] = [], users: string[] = [], audits: string[] = [];
type User = { id: string; email: string; empresa_id: string };
let companyA: string, companyB: string, a: User, worker: User, superadmin: User, b: User, b2: User;
function saveFixtures() { writeFileSync(join(process.env.QA_ARTIFACT_DIR!, "fixtures.json"), JSON.stringify({ run, companies, users, audits }, null, 2)); }
async function company(label: string) {
  const { data, error } = await admin.from("empresas").insert({ nombre: `QA handoff ${run} ${label}`, slug: `qa-handoff-${run}-${label}`, plan: "pro", modulo_compras: true, modulo_ventas: true }).select("id").single();
  expect(error).toBeNull(); companies.push(data!.id); saveFixtures(); return data!.id as string;
}
async function user(label: string, empresaId: string, role: string, extra = {}) {
  const email = `handoff-${run}-${label}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: env.E2E_PASSWORD, email_confirm: true });
  expect(error).toBeNull(); const id = data.user!.id; users.push(id); saveFixtures();
  const result = await admin.from("profiles").insert({ id, email, empresa_id: empresaId, full_name: `QA ${label}`, role, active: true, is_super_admin: false, ...extra });
  expect(result.error).toBeNull(); return { id, email, empresa_id: empresaId };
}
async function login(page: Page, who: User) {
  await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill(who.email);
  await page.getByLabel("Contraseña", { exact: true }).fill(env.E2E_PASSWORD);
  await page.getByRole("button", { name: "Ingresar", exact: true }).click(); await page.waitForURL("**/dashboard");
}
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  companyA = await company("a"); companyB = await company("b");
  a = await user("admin-a", companyA, "admin"); await user("admin-a2", companyA, "admin");
  worker = await user("operador", companyA, "comercial"); superadmin = await user("superadmin", companyA, "comercial", { is_super_admin: true });
  b = await user("admin-b", companyB, "admin"); b2 = await user("admin-b2", companyB, "admin", { active: false });
});

test("tenant admin: own users, role/state actions, cross-tenant/self/SA guards and deletion with operations", async ({ page }) => {
  await login(page, a); await page.goto("/users");
  const row = (email: string) => page.getByRole("row").filter({ hasText: email });
  await expect(row(b.email)).toHaveCount(0);
  await expect(row(a.email).getByRole("combobox")).toBeDisabled();
  await expect(row(a.email).getByRole("button", { name: "Eliminar", exact: true })).toBeDisabled();
  await expect(row(superadmin.email).getByRole("button", { name: "Eliminar", exact: true })).toBeDisabled();
  await row(worker.email).getByRole("combobox").click(); await page.getByRole("option", { name: "Administración", exact: true }).click();
  await expect.poll(async () => (await admin.from("profiles").select("role").eq("id", worker.id).single()).data?.role).toBe("administracion");
  const requestPromise = page.waitForRequest((r) => r.method() === "POST" && Boolean(r.headers()["next-action"]));
  await row(worker.email).getByRole("button", { name: "Desactivar", exact: true }).click();
  const request = await requestPromise;
  await expect(row(worker.email).getByRole("button", { name: "Activar", exact: true })).toBeVisible();
  async function replay(id: string) {
    const response = await page.request.post("/users", { headers: { "Next-Action": request.headers()["next-action"], "Content-Type": "text/plain;charset=UTF-8", Origin: "http://localhost:3042" }, data: JSON.stringify([id, false]) });
    return response.text();
  }
  expect(await replay(b.id)).toContain("ámbito autorizado");
  expect(await replay(a.id)).toContain("propio rol");
  expect(await replay(superadmin.id)).toContain("superadmin está protegido");
  expect((await admin.from("profiles").select("active").eq("id", b.id).single()).data?.active).toBe(true);
  await row(worker.email).getByRole("button", { name: "Activar", exact: true }).click();
  await expect(row(worker.email).getByRole("button", { name: "Desactivar", exact: true })).toBeVisible();
  const audit = await admin.from("audit_logs").insert({ empresa_id: companyA, actor_id: worker.id, actor_type: "internal", action: "HANDOFF_QA_FIXTURE", detail: { run } }).select("id").single();
  expect(audit.error).toBeNull(); audits.push(audit.data!.id); saveFixtures();
  page.on("dialog", (dialog) => dialog.accept());
  await row(worker.email).getByRole("button", { name: "Eliminar", exact: true }).click();
  await expect(row(worker.email).getByRole("alert")).toContainText("desactivalo");
  expect((await admin.auth.admin.getUserById(worker.id)).data.user?.id).toBe(worker.id);
  await page.goto("/empresas"); await expect(page).toHaveURL(/\/dashboard$/);
  await page.screenshot({ path: join(process.env.QA_ARTIFACT_DIR!, "tenant-guard.png"), fullPage: true });
});

test("tenant admin can create/delete an unused account and its previous session is denied", async ({ page, browser }) => {
  await login(page, a); await page.goto("/users");
  const email = `handoff-${run}-temporary@example.com`;
  await page.getByRole("button", { name: "Nuevo usuario", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('[name="email"]').fill(email); await dialog.locator('[name="full_name"]').fill("QA temporal");
  await dialog.locator('[name="password"]').fill(env.E2E_PASSWORD);
  await dialog.getByRole("button", { name: /Crear usuario/ }).click();
  const row = page.getByRole("row").filter({ hasText: email }); await expect(row).toBeVisible();
  const { data: temporary } = await admin.from("profiles").select("id").eq("empresa_id", companyA).eq("email", email).single();
  users.push(temporary!.id); saveFixtures();
  const context = await browser.newContext(); const sessionPage = await context.newPage();
  try {
    await login(sessionPage, { id: temporary!.id, email, empresa_id: companyA });
    page.on("dialog", (dialog) => dialog.accept()); await row.getByRole("button", { name: "Eliminar", exact: true }).click();
    await expect(row).toHaveCount(0);
    expect((await admin.auth.admin.getUserById(temporary!.id)).data.user).toBeNull();
    await sessionPage.goto("/dashboard"); await expect(sessionPage).toHaveURL(/\/login$/);
  } finally { await context.close(); }
});

test("authenticated REST cannot self-upgrade a plan, enable modules or demote/deactivate itself", async () => {
  const c = client(); expect((await c.auth.signInWithPassword({ email: a.email, password: env.E2E_PASSWORD })).error).toBeNull();
  for (const change of [{ plan: "caterpillar" }, { modulo_compras: false }, { modulo_ventas: false }]) {
    const response = await c.from("empresas").update(change).eq("id", companyA).select("id");
    expect(response.error?.code).toBe("42501");
  }
  for (const change of [{ active: false }, { role: "comercial" }]) expect((await c.from("profiles").update(change).eq("id", a.id)).error?.code).toBe("42501");
  expect((await c.from("profiles").select("id").eq("id", b.id)).data).toEqual([]);
});

test("superadmin edits plan/modules, creates company with entitlements and cannot remove last admin", async ({ page }) => {
  await login(page, superadmin); await page.goto("/empresas");
  const card = page.locator('div.rounded-lg').filter({ has: page.getByText(`QA handoff ${run} b`, { exact: true }) }).first();
  const form = card.getByRole("form", { name: "Plan y módulos de la empresa" });
  await form.getByLabel("Plan", { exact: true }).click(); await page.getByRole("option", { name: "Caterpillar", exact: true }).click();
  await form.getByLabel("Compras", { exact: true }).uncheck();
  await form.getByRole("button", { name: "Guardar plan y módulos", exact: true }).click();
  await expect(form.getByRole("status")).toHaveText("Plan y módulos guardados.");
  expect((await admin.from("empresas").select("plan,modulo_compras").eq("id", companyB).single()).data).toEqual({ plan: "caterpillar", modulo_compras: false });
  await card.getByRole("row").filter({ hasText: b.email }).getByRole("button", { name: "Desactivar", exact: true }).click();
  await expect(card.getByText(/único admin activo/)).toBeVisible();
  await page.getByRole("button", { name: "Nueva empresa", exact: true }).click();
  const dialog = page.getByRole("dialog"); const name = `QA handoff ${run} creada UI`;
  await dialog.getByLabel("Nombre", { exact: true }).fill(name); await dialog.getByLabel("Plan", { exact: true }).click(); await page.getByRole("option", { name: "Pro", exact: true }).click();
  await dialog.getByLabel("Compras", { exact: true }).uncheck(); await dialog.getByLabel("Ventas", { exact: true }).check();
  await dialog.getByRole("button", { name: "Crear empresa", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const result = await admin.from("empresas").select("id,plan,modulo_compras,modulo_ventas").eq("nombre", name).single();
  expect(result.error).toBeNull(); companies.push(result.data!.id); saveFixtures();
  expect(result.data).toMatchObject({ plan: "pro", modulo_compras: false, modulo_ventas: true });
  await page.screenshot({ path: join(process.env.QA_ARTIFACT_DIR!, "superadmin-plans.png"), fullPage: true });
});

test("concurrent service-role removals preserve one active admin", async () => {
  expect((await admin.from("profiles").update({ active: true }).eq("id", b2.id)).error).toBeNull();
  const results = await Promise.all([b.id, b2.id].map((id) => admin.from("profiles").update({ active: false }).eq("id", id)));
  expect(results.filter((result) => result.error === null)).toHaveLength(1);
  expect(results.filter((result) => result.error?.message.includes("last_active_admin"))).toHaveLength(1);
  const active = await admin.from("profiles").select("id").eq("empresa_id", companyB).eq("role", "admin").eq("active", true);
  expect(active.data).toHaveLength(1);
});
