/* Preview only. Credentials and screenshots stay in the ignored audit directory.
 * Run after preparing the synthetic fixture and starting localhost:3103.
 * Never point this verification at production. */
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { chromium, expect: baseExpect } = require("@playwright/test");
const expect = baseExpect.configure({ timeout: 60000 });
const { createClient } = require("@supabase/supabase-js");
const XLSX = require("xlsx");
const root = "audit-artifacts/batch-03/private";
const configFile = fs.readFileSync(`${root}/preview-config.json`);
const cfg = JSON.parse(
  configFile
    .toString(configFile[0] === 255 ? "utf16le" : "utf8")
    .replace(/^\uFEFF/, ""),
);
assert.equal(cfg.SUPABASE_URL, "https://afedslxxtttyqunqmutz.supabase.co");
const fixture = JSON.parse(
  fs.readFileSync(`${root}/browser-fixture.json`, "utf8"),
);
const db = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const must = (r) => {
  if (r.error) throw Error(r.error.message);
  return r.data;
};
const base = "http://localhost:3103";
let browser;
const evidence = [];
async function noOrders(rfq) {
  assert.equal(
    must(
      await db
        .from("authorized_orders")
        .select("id")
        .eq("rfq_id", rfq)
        .eq("empresa_id", fixture.empresaId),
    ).length,
    0,
  );
}
async function createRfq(page, purpose, description, productId) {
  await page.goto(`${base}/rfqs`);
  await page
    .getByRole("button", { name: "Nueva solicitud", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Confirmar creación de RFQ" }),
  ).toBeDisabled();
  await dialog.locator("select").first().selectOption(purpose);
  await dialog.getByLabel("Descripción 1", { exact: true }).fill(description);
  await dialog.getByLabel("Cantidad 1", { exact: true }).fill("10");
  await dialog.getByLabel("Unidad 1", { exact: true }).fill("un");
  if (productId)
    await dialog
      .getByLabel("Producto 1", { exact: true })
      .selectOption(productId);
  await dialog
    .getByRole("button", { name: "Confirmar creación de RFQ" })
    .click();
  await page.waitForURL(/\/rfqs\/[0-9a-f-]+$/, { timeout: 120000 });
  return page.url().split("/").pop();
}
async function invite(page) {
  await page
    .getByRole("button", { name: "Invitar proveedores", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  for (const provider of fixture.providers)
    await dialog.getByLabel(provider.name, { exact: true }).check();
  await dialog
    .getByRole("button", { name: "Invitar (2)", exact: true })
    .click();
  await expect(dialog).not.toBeVisible({ timeout: 30000 });
}
async function offer(rfq, link, price, budget) {
  const item = must(
    await db
      .from("rfq_items")
      .select("*")
      .eq("rfq_id", rfq)
      .eq("empresa_id", fixture.empresaId)
      .single(),
  );
  const context = await browser.newContext();
  const portal = await context.newPage();
  const response = await portal.goto(`${base}/cotizar/${link.token}`);
  assert.equal(response.headers()["referrer-policy"], "no-referrer");
  assert.match(response.headers()["cache-control"], /no-store|no-cache/);
  await expect(
    portal.getByRole("button", { name: "Enviar nueva versión" }),
  ).toBeVisible();
  await portal
    .getByLabel(`Precio ${item.descripcion}`, { exact: true })
    .fill(String(price));
  await portal
    .getByLabel(`Disponibilidad ${item.descripcion}`, { exact: true })
    .fill("10");
  await portal
    .getByLabel(`Impuesto ${item.descripcion}`, { exact: true })
    .fill("10");
  await portal
    .getByLabel(`Entrega ${item.descripcion}`, { exact: true })
    .fill("5");
  await portal.locator("[name=budget_number]").fill(budget);
  await portal.locator("[name=currency]").selectOption("PYG");
  await portal.locator("[name=valid_until]").fill("2099-01-01");
  await portal.locator("[name=freight]").fill("20");
  await portal.locator("[name=payment_terms]").fill("30 days");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet([
      {
        rfq_item_id: item.id,
        precio_unitario: price,
        currency: "PYG",
        tax_rate: 10,
        available_quantity: 10,
        lead_time_days: 5,
        freight: 20,
        payment_terms: "30 days",
        valid_until: "2099-01-01T23:59:59.000Z",
      },
    ]),
    "Original supplier quote",
  );
  await portal.locator("[name=attachment]").setInputFiles({
    name: `${budget}.xlsx`,
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
  });
  await portal.getByRole("button", { name: "Enviar nueva versión" }).click();
  await expect(
    portal.locator('form [role="status"], form [role="alert"]'),
  ).toBeVisible({ timeout: 120000 });
  if (await portal.locator('form [role="alert"]').count())
    throw Error(await portal.locator('form [role="alert"]').innerText());
  await expect(portal.locator('form [role="status"]')).toContainText(
    "Versión enviada",
    { timeout: 120000 },
  );
  await context.close();
}
async function main() {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/login`);
  await page.getByLabel("Email", { exact: true }).fill(fixture.email);
  await page.locator("[name=password]").fill(fixture.password);
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await page.waitForURL("**/dashboard", { timeout: 120000 });
  evidence.push("Authenticated login: PASS");
  console.log(evidence.at(-1));
  const product = must(
    await db
      .from("productos")
      .insert({
        empresa_id: fixture.empresaId,
        nombre: "Synthetic RFQ catalog item",
        unidad: "un",
      })
      .select("id")
      .single(),
  );
  const project = must(
    await db
      .from("projects")
      .insert({
        empresa_id: fixture.empresaId,
        name: "Synthetic RFQ pricing project",
        code: `RFQ-SYN-${Date.now()}`,
      })
      .select("id")
      .single(),
  );
  const rfq = await createRfq(
    page,
    "PROCUREMENT",
    "Synthetic RFQ browser item",
    product.id,
  );
  // Fixture association only; the RFQ purpose was chosen through the real UI.
  must(
    await db
      .from("rfqs")
      .update({ project_id: project.id })
      .eq("id", rfq)
      .eq("empresa_id", fixture.empresaId),
  );
  await invite(page);
  const links = must(
    await db
      .from("rfq_providers")
      .select("id,token,provider_id")
      .eq("rfq_id", rfq)
      .eq("empresa_id", fixture.empresaId),
  );
  await offer(
    rfq,
    links.find((l) => l.provider_id === fixture.providers[0].id),
    100,
    "SYN-A1",
  );
  await offer(
    rfq,
    links.find((l) => l.provider_id === fixture.providers[0].id),
    90,
    "SYN-A2",
  );
  await offer(
    rfq,
    links.find((l) => l.provider_id === fixture.providers[1].id),
    95,
    "SYN-B1",
  );
  const quotes = must(
    await db
      .from("quotes")
      .select("id")
      .in(
        "rfq_provider_id",
        links.map((l) => l.id),
      )
      .eq("empresa_id", fixture.empresaId),
  );
  assert.equal(
    must(
      await db
        .from("quote_versions")
        .select("id")
        .in(
          "quote_id",
          quotes.map((q) => q.id),
        )
        .eq("empresa_id", fixture.empresaId),
    ).length,
    3,
  );
  evidence.push(
    "Purpose, invitations, secure anonymous portal, original XLSX upload, append-only correction: PASS",
  );
  console.log(evidence.at(-1));
  const observations = must(
    await db
      .from("cost_observations")
      .select("fuente")
      .eq("empresa_id", fixture.empresaId)
      .eq("producto_id", product.id),
  );
  assert.equal(observations.length, 3);
  assert.ok(observations.every((o) => o.fuente === "COTIZACION"));
  assert.equal(
    must(
      await db
        .from("project_cost_prices")
        .select("id")
        .eq("project_id", project.id)
        .eq("producto_id", product.id)
        .eq("empresa_id", fixture.empresaId),
    ).length,
    0,
  );
  await page.goto(`${base}/rfqs/${rfq}`);
  const reviews = page.locator("details").filter({
    has: page.locator("summary").filter({ hasText: /^Reconciliación/ }),
  });
  assert.equal(await reviews.count(), 2);
  for (let i = 0; i < 2; i++) {
    const review = reviews.nth(i);
    await review.locator("summary").click();
    await review
      .getByRole("button", { name: "Extraer y comparar documento" })
      .click();
    await expect(review.getByRole("status")).toContainText(
      "Documento extraído",
      { timeout: 120000 },
    );
    await review
      .locator("textarea")
      .fill(
        "Synthetic human verification: original XLSX matches structured supplier facts.",
      );
    await review
      .getByRole("button", { name: "Registrar revisión humana" })
      .click();
    await expect(review.getByRole("status")).toContainText(
      "Revisión registrada",
      { timeout: 120000 },
    );
  }
  await noOrders(rfq);
  await page
    .getByRole("button", { name: "Adoptar precio para costeo", exact: true })
    .first()
    .click();
  await expect(page.locator('section > [role="status"]')).toContainText(
    "Precio adoptado desde DB",
  );
  const adopted = must(
    await db
      .from("project_cost_prices")
      .select("precio_unitario,fuente,quote_version_item_id")
      .eq("project_id", project.id)
      .eq("producto_id", product.id)
      .eq("empresa_id", fixture.empresaId)
      .single(),
  );
  assert.equal(adopted.fuente, "COTIZACION");
  const adoptedLine = must(
    await db
      .from("quote_version_items")
      .select("precio_unitario")
      .eq("id", adopted.quote_version_item_id)
      .eq("empresa_id", fixture.empresaId)
      .single(),
  );
  assert.equal(
    Number(adopted.precio_unitario),
    Number(adoptedLine.precio_unitario),
  );
  evidence.push(
    "Pricing market signal only; no automatic adoption; explicit adoption persists DB factual price: PASS",
  );
  console.log(evidence.at(-1));
  await page.locator('input[aria-label^="Asignar"]').nth(0).fill("4");
  await page.locator('input[aria-label^="Asignar"]').nth(1).fill("5");
  await page
    .locator("section textarea")
    .last()
    .fill("Synthetic human partial split across the two reviewed suppliers.");
  await page
    .getByRole("button", { name: "Guardar nueva revisión de asignación" })
    .click();
  await expect(
    page.getByText("Revisión guardada 1.", { exact: false }),
  ).toBeVisible();
  await noOrders(rfq);
  await page
    .getByLabel(
      "Autorizo explícitamente la revisión guardada y su justificación",
    )
    .check();
  await page
    .getByRole("button", { name: "Autorizar asignación guardada" })
    .click();
  await expect(
    page.getByRole("button", { name: "Generar preview de OCs" }),
  ).toBeVisible();
  await noOrders(rfq);
  await page.getByRole("button", { name: "Generar preview de OCs" }).click();
  await expect(
    page.getByText("Preview exacto — 2 OC(s)", { exact: true }),
  ).toBeVisible();
  await noOrders(rfq);
  await page
    .getByRole("heading", { name: "Preview exacto — 2 OC(s)", exact: true })
    .locator("..")
    .screenshot({
      path: `${root}/rfq-order-preview.png`,
    });
  await page
    .getByLabel(
      "Confirmo estas OCs exactas, sus cantidades, precios y condiciones",
    )
    .check();
  await page.getByRole("button", { name: "Confirmar y crear OCs" }).click();
  await expect(
    page.getByText("OCs confirmadas el", { exact: false }),
  ).toBeVisible();
  const orders = must(
    await db
      .from("authorized_orders")
      .select("id,total_price,procurement_snapshot")
      .eq("rfq_id", rfq)
      .eq("empresa_id", fixture.empresaId),
  );
  assert.equal(orders.length, 2);
  for (const order of orders)
    assert.equal(Number(order.total_price), order.procurement_snapshot.total);
  evidence.push(
    "Document reconciliation, human partial split, explicit authorization, exact preview, 2 confirmed OCs: PASS",
  );
  console.log(evidence.at(-1));
  const discovery = await createRfq(
    page,
    "COST_DISCOVERY",
    "Synthetic discovery without purchase",
  );
  await expect(
    page.getByRole("button", { name: "Guardar nueva revisión de asignación" }),
  ).toHaveCount(0);
  await page
    .getByLabel("Confirmo cerrar el descubrimiento de costos sin compra")
    .check();
  await page.getByRole("button", { name: "Finalizar sin OC" }).click();
  await expect(
    page.getByText("Descubrimiento cerrado por decisión humana:", {
      exact: false,
    }),
  ).toBeVisible();
  await noOrders(discovery);
  evidence.push("COST_DISCOVERY ends without purchase: PASS");
  console.log(evidence.at(-1));
  const rfqCount = must(
    await db.from("rfqs").select("id").eq("empresa_id", fixture.empresaId),
  ).length;
  const beforeDirect = must(
    await db
      .from("authorized_orders")
      .select("id")
      .eq("empresa_id", fixture.empresaId),
  ).length;
  await page.goto(`${base}/orders`);
  await page
    .getByRole("button", { name: "+ Nueva compra", exact: true })
    .click();
  const directDialog = page.getByRole("dialog");
  await directDialog
    .locator("[name=provider_id]")
    .selectOption(fixture.providers[0].id);
  await directDialog.locator("[name=currency]").selectOption("USD");
  await directDialog.locator("[name=payment_terms]").fill("Synthetic cash");
  await directDialog
    .locator("[name=observations]")
    .fill("Synthetic human direct purchase notes");
  await directDialog.locator("[name=freight]").fill("5");
  await directDialog
    .locator("label")
    .filter({ hasText: /Impuesto %/ })
    .locator("input")
    .fill("10");
  const row = directDialog.locator("tbody tr").first();
  await row
    .locator("td")
    .nth(0)
    .locator("input")
    .fill("Synthetic direct purchase item");
  await row.locator("td").nth(1).locator("input").fill("0.1234");
  await row.locator("td").nth(2).locator("input").fill("kg");
  await row.locator("td").nth(5).locator("input").fill("100");
  await directDialog
    .getByRole("button", { name: "Preparar preview", exact: true })
    .click();
  await expect(
    directDialog.getByText("Preview exacto", { exact: false }),
  ).toBeVisible();
  assert.equal(
    must(
      await db
        .from("authorized_orders")
        .select("id")
        .eq("empresa_id", fixture.empresaId),
    ).length,
    beforeDirect,
  );
  await expect(row.locator("input").first()).toBeDisabled();
  await expect(
    directDialog.getByRole("button", {
      name: "Confirmar y crear OC",
      exact: true,
    }),
  ).toBeDisabled();
  await directDialog.getByLabel("Confirmo el preview mostrado").check();
  await directDialog
    .getByRole("button", { name: "Confirmar y crear OC", exact: true })
    .click();
  await page.waitForURL(/\/orders\/[0-9a-f-]+$/, { timeout: 120000 });
  const directOrderId = page.url().split("/").pop();
  const directOrder = must(
    await db
      .from("authorized_orders")
      .select("rfq_id,quantity,total_price,procurement_snapshot")
      .eq("id", directOrderId)
      .eq("empresa_id", fixture.empresaId)
      .single(),
  );
  assert.equal(directOrder.rfq_id, null);
  assert.equal(
    directOrder.procurement_snapshot.observations,
    "Synthetic human direct purchase notes",
  );
  assert.equal(Number(directOrder.quantity), 0.1234);
  assert.equal(Number(directOrder.total_price), 18.57);
  assert.equal(
    must(await db.from("rfqs").select("id").eq("empresa_id", fixture.empresaId))
      .length,
    rfqCount,
  );
  evidence.push(
    "Separate direct purchase, fractional quantities, exact server preview, explicit confirmation, no RFQ: PASS",
  );
  console.log(evidence.at(-1));
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    `${root}/browser-result.json`,
    JSON.stringify(
      {
        status: "PASS",
        preview: "afedslxxtttyqunqmutz",
        syntheticEmpresa: fixture.empresaId,
        rfq,
        discovery,
        directOrderId,
        orderIds: orders.map((o) => o.id),
        evidence,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  await browser.close();
}
main().catch(async (e) => {
  console.error(e.message);
  if (browser) await browser.close();
  process.exitCode = 1;
});
