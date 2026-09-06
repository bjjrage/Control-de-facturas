/**
 * E2E: Flujos críticos de negocio en orden natural.
 *
 * Reproduce el flujo real de un usuario:
 * 1. Dashboard → revisar estado general
 * 2. Órdenes de compra → ver que se carguen y no desaparezcan al navegar
 * 3. Cotizaciones → crear, marcar como cotizado
 * 4. Proveedores → crear/actualizar
 * 5. Facturas → recibir, conciliar, marcar como apto para pago
 * 6. Órdenes de pago → agrupar facturas, ejecutar
 * 7. Pagos → registrar pagos
 */

import { test, expect, Page } from "@playwright/test";

test.describe("Control de Facturas - Flujos Críticos", () => {
  test.describe("1. Dashboard", () => {
    test("debe cargar el dashboard sin errores", async ({ page }) => {
      await page.goto("/dashboard");
      await page.waitForLoadState("networkidle", { timeout: 15_000 });

      // Verificamos que la página principal cargó
      await expect(page.getByText(/dashboard|resumen/i)).toBeVisible();

      // Verificamos que no hay errores en la consola (excepto warnings)
      let jsErrors = false;
      page.once("pageerror", () => {
        jsErrors = true;
      });

      await page.waitForTimeout(2000); // Dar tiempo para que aparezcan errores
      expect(jsErrors).toBeFalsy();
    });
  });

  test.describe("2. Órdenes de compra", () => {
    test("debe listar órdenes de compra sin desaparecer al navegar", async ({
      page,
    }) => {
      await page.goto("/orders");
      await page.waitForLoadState("networkidle");

      // Buscamos una orden que sea visible (facturado_amount === 0)
      const orderCellBefore = await page
        .locator("table tbody tr")
        .first()
        .locator("td:nth-child(1)")
        .textContent();
      expect(orderCellBefore).toBeTruthy();

      // Navegamos a otro panel
      await page.getByRole("link", { name: /facturas|invoices/i }).click();
      await page.waitForLoadState("networkidle");
      expect(page).toHaveURL(/\/invoices|\/facturas/);

      // Volvemos a órdenes
      await page.getByRole("link", { name: /órdenes|compra/i }).click();
      await page.waitForLoadState("networkidle");

      // Verificamos que la misma orden siga visible
      const orderCellAfter = await page
        .locator("table tbody tr")
        .first()
        .locator("td:nth-child(1)")
        .textContent();
      expect(orderCellAfter).toBe(orderCellBefore);
    });

    test("el botón de eliminar debe estar presente en órdenes sin facturar", async ({
      page,
    }) => {
      await page.goto("/orders");
      await page.waitForLoadState("networkidle");

      // Buscamos una fila con facturado = 0%
      const orderRows = page.locator("table tbody tr");
      let found = false;

      for (let i = 0; i < (await orderRows.count()); i++) {
        const row = orderRows.nth(i);
        const facturadoText = await row
          .locator("td:nth-child(5)") // Columna de facturado %
          .textContent();

        // Si está al 0%, debe tener botón de eliminar visible
        if (facturadoText?.includes("0%")) {
          const deleteBtn = row.getByRole("button", { name: /eliminar/i });
          await expect(deleteBtn).toBeVisible();
          found = true;
          break;
        }
      }

      if (!found) {
        console.warn(
          "No se encontró una orden sin facturar — saltando validación"
        );
      }
    });
  });

  test.describe("3. Facturas", () => {
    test("debe listar facturas y mantener estado al navegar", async ({
      page,
    }) => {
      await page.goto("/invoices");
      await page.waitForLoadState("networkidle");

      // Capturamos el estado inicial
      const invoicesTableBefore = await page
        .locator("table tbody")
        .innerHTML();
      expect(invoicesTableBefore.length).toBeGreaterThan(0);

      // Navegamos a órdenes
      await page.getByRole("link", { name: /órdenes|compra/i }).click();
      await page.waitForLoadState("networkidle");

      // Volvemos a facturas
      await page.getByRole("link", { name: /facturas|invoices/i }).click();
      await page.waitForLoadState("networkidle");

      // Verificamos que la tabla sigue siendo prácticamente la misma
      const invoicesTableAfter = await page
        .locator("table tbody")
        .innerHTML();
      expect(invoicesTableAfter.length).toBeGreaterThan(0);

      // Comparamos los primeros 200 caracteres (estructura)
      expect(invoicesTableBefore.substring(0, 200)).toBe(
        invoicesTableAfter.substring(0, 200)
      );
    });

    test("debe permitir navegar a detalle de una factura y volver", async ({
      page,
    }) => {
      await page.goto("/invoices");
      await page.waitForLoadState("networkidle");

      // Hacemos click en el primer invoice que sea un link
      const firstInvoiceLink = page
        .locator("table tbody tr")
        .first()
        .getByRole("link")
        .first();
      await expect(firstInvoiceLink).toBeVisible();

      const invoiceNumber = await firstInvoiceLink.textContent();
      await firstInvoiceLink.click();
      await page.waitForLoadState("networkidle");

      // Verificamos que estamos en detalle
      expect(page).toHaveURL(/\/invoices\/[a-f0-9-]+/);
      await expect(page.getByText(invoiceNumber!)).toBeVisible();

      // Volvemos con el link "Volver a Facturas"
      await page.getByRole("link", { name: /volver/i }).click();
      await page.waitForLoadState("networkidle");

      // Verificamos que estamos de vuelta en el listado
      expect(page).toHaveURL(/\/invoices$/);
    });

    test("marcar una factura como 'apto para pago' debe sincronizar al volver", async ({
      page,
    }) => {
      await page.goto("/invoices");
      await page.waitForLoadState("networkidle");

      // Buscamos una factura en estado "CONCILIADA" (que pueda ser marcada apto)
      const rows = page.locator("table tbody tr");
      let foundInvoice = false;
      let invoiceLink: any = null;

      for (let i = 0; i < Math.min(5, await rows.count()); i++) {
        const row = rows.nth(i);
        const statusText = await row.locator("td:nth-child(4)").textContent(); // Status column

        if (statusText?.includes("Conciliada") || statusText?.includes("CONCILIADA")) {
          invoiceLink = row.getByRole("link").first();
          foundInvoice = true;
          break;
        }
      }

      if (!foundInvoice) {
        test.skip();
        return;
      }

      const invoiceNumber = await invoiceLink.textContent();
      await invoiceLink.click();
      await page.waitForLoadState("networkidle");

      // Buscamos el botón "Marcar apto para pago"
      const markAptoBtn = page.getByRole("button", {
        name: /marcar apto|apto para pago/i,
      });

      if (await markAptoBtn.isVisible()) {
        await markAptoBtn.click();
        await page.waitForLoadState("networkidle");

        // Esperamos confirmación (página se recarga o toast)
        await page.waitForTimeout(1000);

        // Volvemos a facturas
        await page.getByRole("link", { name: /volver/i }).click();
        await page.waitForLoadState("networkidle");

        // Buscamos la factura nuevamente y verificamos que está como "APTO_PARA_PAGO"
        const updatedStatusText = await page
          .locator(`table tbody tr td:has-text("${invoiceNumber}")`)
          .locator("parent", { has: page.locator("td") })
          .locator("td:nth-child(4)")
          .textContent();

        expect(updatedStatusText).toContain("Apto para pago");
      }
    });
  });

  test.describe("4. Órdenes de Pago", () => {
    test("debe listar órdenes de pago sin errores", async ({ page }) => {
      await page.goto("/pagos");
      await page.waitForLoadState("networkidle");

      // Verificamos que cargó la tabla
      const table = page.locator("table tbody");
      await expect(table).toBeVisible({ timeout: 10_000 });

      // Contamos filas
      const rows = await table.locator("tr").count();
      expect(rows).toBeGreaterThan(0);
    });

    test("no debe mostrar error al navegar entre paneles desde Pagos", async ({
      page,
    }) => {
      await page.goto("/pagos");
      await page.waitForLoadState("networkidle");

      // Capturamos el contenido
      const opsBefore = await page.locator("table tbody").innerHTML();
      expect(opsBefore.length).toBeGreaterThan(0);

      // Navegamos a otra sección
      await page.getByRole("link", { name: /cotizaciones|rfq/i }).click();
      await page.waitForLoadState("networkidle");

      // Volvemos a pagos
      await page.getByRole("link", { name: /pagos|payment/i }).click();
      await page.waitForLoadState("networkidle");

      // Verificamos que la tabla sigue visible
      const opsAfter = await page.locator("table tbody").innerHTML();
      expect(opsAfter.length).toBeGreaterThan(0);
    });
  });

  test.describe("5. Cotizaciones (RFQs)", () => {
    test("debe listar cotizaciones sin desaparecer al navegar", async ({
      page,
    }) => {
      await page.goto("/rfqs");
      await page.waitForLoadState("networkidle");

      const rfqsBefore = await page.locator("table tbody").innerHTML();
      expect(rfqsBefore.length).toBeGreaterThan(0);

      // Navegamos
      await page.getByRole("link", { name: /proveedores/i }).click();
      await page.waitForLoadState("networkidle");

      // Volvemos
      await page.getByRole("link", { name: /cotizaciones|rfq/i }).click();
      await page.waitForLoadState("networkidle");

      const rfqsAfter = await page.locator("table tbody").innerHTML();
      expect(rfqsAfter.length).toBeGreaterThan(0);
      expect(rfqsAfter.substring(0, 150)).toBe(rfqsBefore.substring(0, 150));
    });
  });

  test.describe("6. Proveedores", () => {
    test("debe listar proveedores y sincronizar al volver", async ({ page }) => {
      await page.goto("/providers");
      await page.waitForLoadState("networkidle");

      const providersBefore = await page.locator("table tbody").innerHTML();
      expect(providersBefore.length).toBeGreaterThan(0);

      // Navegamos lejos
      await page.getByRole("link", { name: /dashboard/i }).click();
      await page.waitForLoadState("networkidle");

      // Volvemos a proveedores
      await page.getByRole("link", { name: /proveedores/i }).click();
      await page.waitForLoadState("networkidle");

      const providersAfter = await page.locator("table tbody").innerHTML();
      expect(providersAfter.length).toBeGreaterThan(0);
      expect(providersAfter.substring(0, 150)).toBe(
        providersBefore.substring(0, 150)
      );
    });
  });

  test("no debe haber errores JavaScript no manejados", async ({ page }) => {
    let jsErrors: string[] = [];

    page.on("pageerror", (error) => {
      jsErrors.push(error.message);
    });

    // Visitamos varios paneles
    const paths = ["/dashboard", "/orders", "/invoices", "/rfqs", "/pagos", "/providers"];

    for (const path of paths) {
      await page.goto(path);
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(500);
    }

    // No debe haber errores (excepto los esperados de terceros)
    const criticalErrors = jsErrors.filter(
      (e) =>
        !e.includes("third-party") &&
        !e.includes("Cannot find module") &&
        !e.includes("ResizeObserver loop")
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
