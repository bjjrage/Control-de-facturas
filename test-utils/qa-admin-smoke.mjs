// Focused real UI smoke against the authorized branch; no mocked application calls.
import fs from "node:fs";
import path from "node:path";
import { chromium, expect as playwrightExpect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import XLSX from "xlsx";

const privateFile = path.resolve(process.argv[2]);
const root = path.dirname(privateFile);
const identity = JSON.parse(fs.readFileSync(path.join(root, "qa-identity-private.json"), "utf8"));
const credentials = JSON.parse(fs.readFileSync(privateFile, "utf8").replace(/^\uFEFF/, ""));
const baseURL = "http://localhost:3115";
const expect = playwrightExpect.configure({ timeout: 90000 });
if (identity.url !== "https://voxiddrfhfanbyatpcvb.supabase.co" || credentials.SUPABASE_URL !== identity.url) throw new Error("Unexpected database target");
const pack = path.resolve(root, "../QA_E2E_ADMIN_FULL_PACK");
const out = path.join(root, "smoke");
fs.mkdirSync(out, { recursive: true });
const stateFile = path.join(out, "state.json");
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : { stages: {} };
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
const db = createClient(identity.url, credentials.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const read = async (query) => { const { data, error } = await query; if (error) throw new Error(error.message); return data; };
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(120000);
const errors = [];
page.on("pageerror", e => errors.push(e.message));
await page.route("https://ezucivipgmbvamhugkbj.supabase.co/**", route => { errors.push("Production request blocked"); return route.abort(); });
const option = async (trigger, name) => { await trigger.click(); await page.getByRole("option", { name, exact: true }).click(); };
const screenshot = name => page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
let activeStage = "login";
try {
  await page.goto(`${baseURL}/login`);
  await page.getByLabel("Email", { exact: true }).fill(identity.email);
  await page.getByLabel("Contraseña", { exact: true }).fill(identity.password);
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/);
  const profile = await read(db.from("profiles").select("id,empresa_id,role,is_super_admin").eq("id", identity.userId).single());
  expect(profile.empresa_id).toBe(identity.empresaId);
  expect(profile.is_super_admin).toBe(false);
  for (const stage of ["providers", "project", "units", "budget", "certificate", "rfq"]) {
    if (state.stages[stage] === "PASS") continue;
    activeStage = stage;
    console.log(`START ${stage}`);
    if (stage === "providers") {
      await page.goto(`${baseURL}/dashboard`);
      await page.getByRole("button", { name: "Comprar", exact: true }).click();
      await page.getByRole("link", { name: "Proveedores", exact: true }).click();
      await expect(page).toHaveURL(/\/providers$/);
      for (const [index, name] of ["Cementos QA Remediation", "Ferretería QA Remediation"].entries()) {
        await page.getByRole("button", { name: "Nuevo proveedor", exact: true }).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("Nombre", { exact: true }).fill(name);
        await dialog.getByLabel("Email", { exact: true }).fill(`vendor-${index}@example.test`);
        await dialog.getByRole("button", { name: "Guardar", exact: true }).click();
        await expect(dialog).not.toBeVisible();
        await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(1);
      }
      const providers = await read(db.from("providers").select("id,name").eq("empresa_id", identity.empresaId));
      expect(providers).toHaveLength(2);
      state.providers = providers;
    }
    if (stage === "project") {
      await page.goto(`${baseURL}/projects`);
      await page.getByRole("button", { name: "Nueva obra", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: /Crear manualmente/ }).click();
      for (const [id, value] of Object.entries({ np_name: "Obra QA Remediation", np_code: "QA-REM-001", np_client: "Comitente QA", np_start: "2026-10-01", np_end: "2027-01-29", np_budget: "500000000" })) await dialog.locator(`#${id}`).fill(value);
      await dialog.getByRole("button", { name: "Crear proyecto", exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect(page.getByText("Obra QA Remediation", { exact: true })).toBeVisible();
      const projects = await read(db.from("projects").select("id,name").eq("empresa_id", identity.empresaId));
      expect(projects).toHaveLength(1);
      state.projectId = projects[0].id;
    }
    if (stage === "units") {
      const master = XLSX.read(fs.readFileSync(path.join(pack, "QA_Administracion_Master.xlsx")), { type: "buffer" });
      const materials = XLSX.utils.sheet_to_json(master.Sheets["04_Materiales"]).filter(r => String(r["MATERIALES A CREAR EN STOCK"]).startsWith("MAT-"));
      for (const material of materials) {
        const sku = material["MATERIALES A CREAR EN STOCK"];
        const existing = await read(db.from("productos").select("id").eq("empresa_id", identity.empresaId).eq("sku", sku));
        if (existing.length) continue;
        await page.goto(`${baseURL}/stock/nuevo`);
        await page.locator("#p-nombre").fill(material.__EMPTY);
        await option(page.locator("#p-unidad"), material.__EMPTY_2);
        await page.getByPlaceholder("Opcional", { exact: true }).first().fill(sku);
        if (material.__EMPTY_3) {
          await page.getByPlaceholder("Ej: 25", { exact: true }).fill(String(material.__EMPTY_3));
          await option(page.getByRole("combobox").nth(2), material.__EMPTY_4);
        }
        await page.getByRole("button", { name: "Crear material", exact: true }).click();
        await expect(page).toHaveURL(/\/stock\/[0-9a-f-]+$/);
        const rows = await read(db.from("productos").select("unidad,unidad_base").eq("empresa_id", identity.empresaId).eq("sku", sku));
        expect(rows).toHaveLength(1);
        expect(rows[0].unidad).toBe(material.__EMPTY_2);
        if (material.__EMPTY_4) expect(rows[0].unidad_base).toBe(material.__EMPTY_4);
        await screenshot(`unit-${sku}`);
      }
    }
    if (stage === "budget") {
      const previousItems = await read(db.from("budget_items").select("id").eq("project_id", state.projectId));
      if (previousItems.length && !state.budgetSubmissionObserved) {
        // A previous harness failure after save must not be retried by importing
        // into the same populated project. Use a new normal UI fixture instead.
        state.supersededProjectId = state.projectId;
        await page.goto(`${baseURL}/projects`);
        await page.getByRole("button", { name: "Nueva obra", exact: true }).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("button", { name: /Crear manualmente/ }).click();
        for (const [id, value] of Object.entries({ np_name: "Obra QA Remediation — smoke final", np_code: "QA-REM-002", np_client: "Comitente QA", np_start: "2026-10-01", np_end: "2027-01-29", np_budget: "500000000" })) await dialog.locator(`#${id}`).fill(value);
        await dialog.getByRole("button", { name: "Crear proyecto", exact: true }).click();
        await expect(dialog).not.toBeVisible();
        await expect(page.getByText("Obra QA Remediation — smoke final", { exact: true })).toBeVisible();
        const project = await read(db.from("projects").select("id").eq("empresa_id", identity.empresaId).eq("code", "QA-REM-002").single());
        state.projectId = project.id;
        save();
      }
      await page.goto(`${baseURL}/projects/${state.projectId}?tab=presupuesto`);
      if (!state.budgetSubmissionObserved) {
        await page.getByRole("button", { name: "Importar Excel", exact: true }).click();
        const dialog = page.getByRole("dialog");
        await dialog.locator('input[type="file"]').setInputFiles(path.join(pack, "QA_Presupuesto_Obra.xlsx"));
        await dialog.getByRole("button", { name: "Siguiente", exact: true }).click();
        await dialog.getByRole("button", { name: "Importar 6 ítems", exact: true }).click();
        await expect(dialog).not.toBeVisible();
        await expect(page.getByText("Mampostería de ladrillo común", { exact: true }).first()).toBeVisible();
        state.budgetSubmissionObserved = true;
        save();
      }
      const rows = await read(db.from("budget_items").select("id").eq("project_id", state.projectId));
      expect(rows).toHaveLength(6);
    }
    if (stage === "certificate") {
      await page.goto(`${baseURL}/projects/${state.projectId}?tab=certificados`);
      await page.getByRole("button", { name: "Importar certificado", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.locator('input[type="file"]').setInputFiles(path.join(pack, "QA_Certificado_01.xlsx"));
      await dialog.getByRole("button", { name: "Analizar y mostrar preview", exact: true }).click();
      await expect(dialog.getByRole("button", { name: /Confirmar importación · BORRADOR|Abrir certificado existente/ })).toBeVisible();
      const acknowledgement = dialog.getByRole("checkbox");
      if (await acknowledgement.count()) await acknowledgement.check();
      await dialog.getByRole("button", { name: /Confirmar importación · BORRADOR|Abrir certificado existente/ }).click();
      await expect(dialog).not.toBeVisible();
      await expect(page.locator('[id^="certificate-row-"]')).toHaveCount(1);
      const rows = await read(db.from("project_certificates").select("id,monto_presente,status").eq("project_id", state.projectId));
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].monto_presente)).toBe(53000000);
      expect(rows[0].status).toBe("BORRADOR");
    }
    if (stage === "rfq") {
      if (!state.rfqId) {
        await page.goto(`${baseURL}/rfqs`);
        await page.getByRole("button", { name: /Nueva solicitud|Nuevo RFQ/ }).click();
        const dialog = page.getByRole("dialog");
        await option(dialog.locator("#rfq-purpose"), "Comprar — asignación y confirmación humanas");
        for (const [index, description, quantity, unit] of [[1, "Cemento Portland 50 kg", 60, "bolsa"], [2, "Ladrillo común", 3000, "un"]]) {
          if (index === 2) await dialog.getByRole("button", { name: "Agregar ítem", exact: true }).click();
          await dialog.getByLabel(`Descripción ${index}`, { exact: true }).fill(description);
          await dialog.getByLabel(`Cantidad ${index}`, { exact: true }).fill(String(quantity));
          await dialog.getByLabel(`Unidad ${index}`, { exact: true }).fill(unit);
        }
        await dialog.getByRole("button", { name: "Confirmar creación de RFQ", exact: true }).click();
        await expect(page).toHaveURL(/\/rfqs\/[0-9a-f-]+$/);
        state.rfqId = page.url().split("/").at(-1);
        save();
      } else await page.goto(`${baseURL}/rfqs/${state.rfqId}`);
      const invited = await read(db.from("rfq_providers").select("id").eq("rfq_id", state.rfqId));
      if (!invited.length) {
        await page.getByRole("button", { name: "Invitar proveedores", exact: true }).click();
        const dialog = page.getByRole("dialog");
        for (const vendor of state.providers) await dialog.getByRole("checkbox", { name: vendor.name, exact: true }).check();
        await dialog.getByRole("button", { name: "Invitar (2)", exact: true }).click();
        await expect(dialog).not.toBeVisible();
        await expect(page.getByText("Link del proveedor", { exact: true })).toHaveCount(2);
      }
      for (const vendor of state.providers) {
        const cementVendor = vendor.name.startsWith("Cementos");
        const prices = cementVendor ? [68000, 1550] : [72000, 1400];
        const leads = cementVendor ? [2, 3] : [1, 2];
        const payment = cementVendor ? "30 días" : "15 días";
        const original = cementVendor ? "COT-QA-001_Cementos.pdf" : "COT-QA-002_Ferreteria.pdf";
        const card = page.locator("div.border.rounded.p-3.space-y-2").filter({ has: page.locator("strong", { hasText: vendor.name }) });
        const provider = (await read(db.from("rfq_providers").select("id").eq("rfq_id", state.rfqId).eq("provider_id", vendor.id).single()));
        const quotes = await read(db.from("quotes").select("id").eq("rfq_provider_id", provider.id));
        const versions = quotes.length ? await read(db.from("quote_versions").select("id").in("quote_id", quotes.map(q => q.id))) : [];
        if (!versions.length) {
          await card.locator("summary").click();
          const form = card.locator("form");
          for (const [i, description] of ["Cemento Portland 50 kg", "Ladrillo común"].entries()) {
            await form.getByLabel(`Precio ${description}`, { exact: true }).fill(String(prices[i]));
            await form.getByLabel(`Disponibilidad ${description}`, { exact: true }).fill(String(i ? 3000 : 60));
            await form.getByLabel(`Impuesto ${description}`, { exact: true }).fill("0");
            await form.getByLabel(`Entrega ${description}`, { exact: true }).fill(String(leads[i]));
          }
          await form.locator('[name="budget_number"]').fill(cementVendor ? "COT-QA-001" : "COT-QA-002");
          await option(form.getByRole("combobox"), "PYG");
          await form.locator('[name="valid_until"]').fill("2026-10-17");
          await form.locator('[name="freight"]').fill("0");
          await form.locator('[name="payment_terms"]').fill(payment);
          await form.locator('[name="observations"]').fill("Fixture sintético QA; impuesto y flete no especificados en documento, 0 en oferta de prueba para reconciliación explícita.");
          await form.locator('[name="attachment"]').setInputFiles(path.join(pack, original));
          await form.getByRole("button", { name: "Enviar nueva versión", exact: true }).click();
          await expect(form.getByRole("status")).toContainText("Versión enviada");
        }
        const review = page.locator("details").filter({ has: page.locator("summary", { hasText: `Reconciliación ${vendor.name}` }) });
        await expect(review).toHaveCount(1);
        if ((await review.locator("summary").innerText()).includes("— revisada")) continue;
        await review.locator("summary").click();
        await review.getByRole("button", { name: "Extraer y comparar documento", exact: true }).click();
        await expect(review.locator("pre")).toContainText("MOCK QA - SIN VALIDEZ");
        await expect(review).not.toContainText("DOMMatrix is not defined");
        const lines = review.locator("div.grid.grid-cols-3");
        await expect(lines).toHaveCount(2);
        for (let i = 0; i < 2; i++) {
          const line = lines.nth(i);
          for (const [label, value] of Object.entries({ "Precio documento": prices[i], "Moneda documento": "PYG", "Disponible documento": i ? 3000 : 60, "Entrega documento días": leads[i], "Pago documento": payment, "Vigencia documento": "2026-10-17" })) await line.getByLabel(label, { exact: true }).fill(String(value));
        }
        await review.locator("textarea").fill("Revisión humana de fixture QA: precios, cantidades, entrega, moneda, pago y vigencia leídos del original. Impuesto y flete no constan; se preserva ausencia documental y se justifica la diferencia con los valores 0 declarados en la oferta sintética. Sin adjudicación ni OC.");
        await review.getByRole("button", { name: "Registrar revisión humana", exact: true }).click();
        await expect(review.locator("summary")).toContainText("— revisada");
        await screenshot(`rfq-review-${cementVendor ? "cementos" : "ferreteria"}`);
      }
      await expect(page.getByRole("cell").filter({ hasText: "Revisión humana registrada" })).toHaveCount(4);
      await expect(page.getByRole("button", { name: "Usar como propuesta editable", exact: true }).first()).toBeVisible();
      await page.getByRole("button", { name: "Usar como propuesta editable", exact: true }).first().click();
      const orders = await read(db.from("authorized_orders").select("id").eq("empresa_id", identity.empresaId));
      expect(orders).toHaveLength(0);
      state.noAutomaticOrders = true;
      // Stop before saving allocations, authorization, or creating an order.
    }
    state.stages[stage] = "PASS";
    save();
    await screenshot(stage);
    console.log(`PASS ${stage}`);
  }
  if (state.supersededProjectId && !state.supersededProjectCleaned) {
    activeStage = "cleanup-own-fixture";
    const superseded = await read(db.from("projects").select("id,name,code,empresa_id").eq("id", state.supersededProjectId).eq("empresa_id", identity.empresaId).single());
    if (superseded.code !== "QA-REM-001" || superseded.name !== "Obra QA Remediation") throw new Error("Refusing cleanup of an unexpected project");
    await page.goto(`${baseURL}/projects/${superseded.id}?tab=presupuesto`);
    await screenshot("superseded-fixture-before-cleanup");
    page.once("dialog", dialog => dialog.accept());
    await page.getByTitle("Eliminar obra", { exact: true }).click();
    await expect(page).toHaveURL(/\/projects$/);
    expect(await read(db.from("projects").select("id").eq("id", superseded.id).eq("empresa_id", identity.empresaId))).toHaveLength(0);
    state.supersededProjectCleaned = true;
    save();
    console.log("PASS cleanup of this smoke's superseded isolated fixture");
  }
} catch (error) {
  await screenshot(`failure-${activeStage}`).catch(() => {});
  fs.writeFileSync(path.join(out, `failure-${activeStage}.txt`), `${page.url()}\n${error.stack}\n\n${await page.locator("body").innerText()}`);
  console.error(`${activeStage}: ${error.message}`);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(out, "browser-errors.json"), JSON.stringify(errors, null, 2));
  await browser.close();
}
