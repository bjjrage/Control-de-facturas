import { test, expect } from "@playwright/test";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { assertNonProductionTestTarget } from "../../test-utils/external-test-target";

// Fixtures belong only to the disposable full Supabase stack owned by CI.
const ids = { empresa: randomUUID(), invoice: randomUUID(), line: randomUUID(), order: randomUUID(), orderLine: randomUUID() };
const email = `r3-${ids.empresa}@example.test`;
const password = `R3-local-${randomUUID()}!`;
let db: Client;

test.beforeAll(async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL!;
  const apiUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  for (const [label, url] of [["E2E database", databaseUrl], ["E2E auth", apiUrl]]) {
    assertNonProductionTestTarget({ url, label });
    if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) throw new Error(`${label} must use loopback`);
  }
  db = new Client({ connectionString: databaseUrl });
  await db.connect();
  await db.query("SET statement_timeout='15s'");
  const admin = createClient(apiUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(error?.message ?? "Local test user creation failed");
  const userId = data.user.id;
  await db.query("INSERT INTO public.empresas(id,nombre,slug) VALUES($1,'R3 E2E', $2)", [ids.empresa, `r3-${ids.empresa}`]);
  await db.query(`INSERT INTO public.profiles(id,email,full_name,role,empresa_id)
    VALUES($1,$2,'R3 Admin','admin',$3) ON CONFLICT(id) DO UPDATE SET empresa_id=EXCLUDED.empresa_id,role='admin',active=true`, [userId, email, ids.empresa]);
  const provider = (await db.query("INSERT INTO public.providers(empresa_id,name) VALUES($1,'R3 Supplier') RETURNING id", [ids.empresa])).rows[0].id;
  await db.query(`INSERT INTO public.authorized_orders(id,empresa_id,provider_id,provider_name,product,quantity,unit,
      unit_price,total_price,currency,vat_included,authorized_by,created_from)
    VALUES($1,$2,$3,'R3 Supplier','Ladrillo comun',3000,'un',1400,4200000,'PYG',true,$4,'invoice')`, [ids.order, ids.empresa, provider, userId]);
  await db.query(`INSERT INTO public.authorized_order_items(id,order_id,empresa_id,product,quantity,unit,unit_price,total_price)
    VALUES($1,$2,$3,'Ladrillo comun',3000,'un',1400,4200000)`, [ids.orderLine, ids.order, ids.empresa]);
  await db.query(`INSERT INTO public.invoices(id,empresa_id,provider_id,invoice_number,invoice_date,total,currency,created_by)
    VALUES($1,$2,$3,'R3-E2E-001',CURRENT_DATE,3500000,'PYG',$4)`, [ids.invoice, ids.empresa, provider, userId]);
  await db.query(`INSERT INTO public.invoice_items(id,invoice_id,empresa_id,product_description,quantity,unit,unit_price,subtotal)
    VALUES($1,$2,$3,'Ladrillo comun',2500,'un',1400,3500000)`, [ids.line, ids.invoice, ids.empresa]);
  await db.query("INSERT INTO public.invoice_order_matches(invoice_id,authorized_order_id,empresa_id) VALUES($1,$2,$3)", [ids.invoice, ids.order, ids.empresa]);
});

test.afterAll(async () => { await db?.end(); });

async function quantities() {
  return (await db.query(`SELECT oi.quantity_invoiced::text AS invoiced,l.quantity::text AS documented,l.unit,
    (SELECT count(*)::int FROM public.invoice_item_matches WHERE invoice_item_id=l.id) AS matches
    FROM public.authorized_order_items oi CROSS JOIN public.invoice_items l WHERE oi.id=$1 AND l.id=$2`, [ids.orderLine, ids.line])).rows[0];
}

test("browser actions preserve quantities, roll back invalid corrections and unlink atomically", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto(`/invoices/${ids.invoice}`);
  await expect(page.getByText("Sin conciliar", { exact: true })).toBeVisible();

  const impute = async () => {
    await page.getByRole("button", { name: "Imputar", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("select").selectOption(ids.orderLine);
    await dialog.locator('input[type="number"]').fill("2500");
    await dialog.getByRole("button", { name: "Confirmar imputación", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect.poll(async () => (await quantities()).invoiced).toBe("2500.00");
    await expect(page.getByRole("button", { name: /^Quitar imputación / })).toBeVisible();
  };
  await impute();
  expect(await quantities()).toMatchObject({ documented: "2500.00", matches: 1 });
  await page.getByRole("button", { name: /^Quitar imputación / }).click();
  await expect.poll(async () => (await quantities()).matches).toBe(0);
  expect((await quantities()).invoiced).toBe("0.00");
  await impute();

  await page.getByRole("button", { name: "Corregir", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.locator('input[type="number"]').first().fill("2000");
  await dialog.getByRole("button", { name: "Guardar corrección", exact: true }).click();
  await expect(dialog.getByText(/sobre.imputada|quitá imputaciones/)).toBeVisible();
  expect(await quantities()).toMatchObject({ documented: "2500.00", invoiced: "2500.00", matches: 1 });
  await page.keyboard.press("Escape");
  await page.reload();

  // An incompatible unit explicitly removes the old match in the same txn.
  await page.getByRole("button", { name: "Corregir", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.locator('input:not([type="number"])').nth(1).fill("kg");
  await dialog.getByRole("button", { name: "Guardar corrección", exact: true }).click();
  await expect.poll(async () => (await quantities()).matches).toBe(0);
  expect(await quantities()).toMatchObject({ unit: "kg", invoiced: "0.00", documented: "2500.00" });
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByText("Sin conciliar", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Corregir", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.locator('input:not([type="number"])').nth(1).fill("un");
  await dialog.getByRole("button", { name: "Guardar corrección", exact: true }).click();
  await expect.poll(async () => (await quantities()).unit).toBe("un");
  await expect.poll(async () => (await quantities()).matches).toBe(1);
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByRole("button", { name: /^Quitar imputación / })).toBeVisible();

  await page.getByRole("button", { name: "Desvincular", exact: true }).click();
  await expect(page.getByRole("button", { name: "Desvincular", exact: true })).not.toBeVisible();
  expect(await quantities()).toMatchObject({ invoiced: "0.00", matches: 0 });
  expect((await db.query("SELECT count(*)::int AS n FROM public.invoice_order_matches WHERE invoice_id=$1", [ids.invoice])).rows[0].n).toBe(0);
  const audits = (await db.query("SELECT action,empresa_id FROM public.audit_logs WHERE invoice_id=$1", [ids.invoice])).rows;
  expect(audits.some((a) => a.action === "invoice.item_matched")).toBe(true);
  expect(audits.some((a) => a.action === "invoice.item_corrected")).toBe(true);
  expect(audits.every((a) => a.empresa_id === ids.empresa)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("unlinked-integrity.png"), fullPage: true });
});
