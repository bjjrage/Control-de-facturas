import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const AUTH_FILE_A = path.join(__dirname, '.auth/admin.json');

test.describe('Invoice Dialog Control Scanner UI & E2E Integration', () => {
  test('Flujo completo desde UI: Abrir Nueva Factura -> Escanear desde celular -> QR/PIN -> Móvil captura 2 páginas -> Filtros -> Desktop recibe completed -> PDF adjunto en formulario', async ({
    browser,
  }) => {
    // 1. Contexto Desktop Autenticado (1366x768)
    const storageStateA = fs.existsSync(AUTH_FILE_A) ? AUTH_FILE_A : undefined;
    const desktopContext = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      storageState: storageStateA,
    });
    const desktopPage = await desktopContext.newPage();

    // 2. Contexto Móvil (390x844 - iPhone) sin sesión previa de ERP
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      storageState: { cookies: [], origins: [] },
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      permissions: ['camera'],
    });
    const mobilePage = await mobileContext.newPage();

    // 3. Desktop navega a /invoices
    await desktopPage.goto('/invoices');
    await desktopPage.waitForLoadState('domcontentloaded');

    // 4. Abrir diálogo de "Nueva factura"
    const nuevaFacturaBtn = desktopPage.getByRole('button', { name: /Nueva factura/i }).first();
    await expect(nuevaFacturaBtn).toBeVisible({ timeout: 10000 });
    await nuevaFacturaBtn.click();

    // 5. Verificar que el diálogo de Nueva factura está visible con los botones requeridos
    const invoiceDialog = desktopPage.getByRole('dialog');
    await expect(invoiceDialog).toBeVisible({ timeout: 5000 });
    await expect(invoiceDialog.getByText(/Documento \/ Comprobante/i)).toBeVisible();
    await expect(invoiceDialog.getByRole('button', { name: /Subir archivo/i })).toBeVisible();

    const scanBtn = invoiceDialog.getByRole('button', { name: /Escanear desde celular/i });
    await expect(scanBtn).toBeVisible();

    // 6. Iniciar sesión de escaneo haciendo click en "Escanear desde celular"
    const sessionPromise = desktopPage.waitForResponse(
      (res) => res.url().includes('/api/scanner/session') && res.request().method() === 'POST'
    );
    await scanBtn.click();
    const sessionRes = await sessionPromise;
    expect(sessionRes.ok()).toBeTruthy();
    const sessionData = await sessionRes.json();
    expect(sessionData.sessionId).toBeDefined();
    expect(sessionData.joinUrl).toBeDefined();
    expect(sessionData.pinCode).toBeDefined();

    // 7. Verificar que el modal de Control Scanner muestra el QR, PIN y estado de espera
    const scannerModal = desktopPage.getByRole('dialog').filter({ hasText: /Control Scanner/i });
    await expect(scannerModal).toBeVisible({ timeout: 5000 });
    await expect(scannerModal.getByText(/Escaneá este código con tu celular/i)).toBeVisible();
    await expect(scannerModal.getByText(/PIN DE SESIÓN/i)).toBeVisible();
    await expect(scannerModal.locator('img[alt="QR de escaneo"]')).toBeVisible();
    await expect(scannerModal.getByText(/Esperando celular…/i)).toBeVisible();

    // 8. Móvil abre la URL del QR: /scanner?t=TOKEN
    await mobilePage.goto(sessionData.joinUrl);

    // 9. Verificar conexión en móvil
    await expect(mobilePage.getByText('Conectado al ERP')).toBeVisible({ timeout: 10000 });
    await expect(mobilePage.getByRole('button', { name: /Abrir Cámara/i })).toBeVisible();

    // 10. Verificar que Desktop refleja "Celular conectado"
    await expect(scannerModal.getByText(/Celular conectado/i)).toBeVisible({ timeout: 10000 });

    // 11. Capturar Página 1 en móvil
    await mobilePage.getByRole('button', { name: /Abrir Cámara/i }).click();

    const sampleImageBuffer = Buffer.from(
      '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
      'base64'
    );

    let fileChooserPromise = mobilePage.waitForEvent('filechooser');
    await mobilePage.locator('button[title="Subir desde galería"]').click();
    let fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: 'factura-p1.jpg',
      mimeType: 'image/jpeg',
      buffer: sampleImageBuffer,
    });

    // Ajustar bordes Página 1
    await expect(mobilePage.getByText(/Ajustar bordes/i)).toBeVisible({ timeout: 10000 });
    await mobilePage.getByRole('button', { name: /Confirmar/i }).click();

    // Filtros Página 1: Documento
    await expect(mobilePage.getByText(/Mejora de imagen/i)).toBeVisible({ timeout: 10000 });
    await mobilePage.getByRole('button', { name: /Documento/i }).click();
    await mobilePage.getByRole('button', { name: /Guardar página/i }).click();

    // 12. Capturar Página 2 en móvil
    await expect(mobilePage.getByText(/Documento Escaneado/i)).toBeVisible({ timeout: 10000 });
    await mobilePage.getByRole('button', { name: /Agregar página/i }).click();

    fileChooserPromise = mobilePage.waitForEvent('filechooser');
    await mobilePage.locator('button[title="Subir desde galería"]').click();
    fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: 'factura-p2.jpg',
      mimeType: 'image/jpeg',
      buffer: sampleImageBuffer,
    });

    // Ajustar bordes Página 2
    await expect(mobilePage.getByText(/Ajustar bordes/i)).toBeVisible({ timeout: 10000 });
    await mobilePage.getByRole('button', { name: /Confirmar/i }).click();

    // Filtros Página 2: B&N
    await expect(mobilePage.getByText(/Mejora de imagen/i)).toBeVisible({ timeout: 10000 });
    await mobilePage.getByRole('button', { name: /B\s*&\s*N/i }).click();
    await mobilePage.getByRole('button', { name: /Guardar página/i }).click();

    // 13. Finalizar y enviar en móvil
    await expect(mobilePage.getByText(/2 páginas listas/i)).toBeVisible({ timeout: 10000 });
    await mobilePage.getByRole('button', { name: /Finalizar y Enviar al ERP/i }).click();
    await expect(mobilePage.getByText(/¡Documento Enviado!/i)).toBeVisible({ timeout: 15000 });

    // 14. Desktop recibe completion
    // En el modal o al cerrarlo, el formulario de factura debe incorporar el documento
    if (await scannerModal.isVisible()) {
      const usarDocBtn = scannerModal.getByRole('button', { name: /Usar documento/i });
      if (await usarDocBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await usarDocBtn.click();
      }
    }

    // 15. Verificar que en InvoiceDialog el documento está incorporado
    await expect(invoiceDialog.getByText(/Documento recibido desde Control Scanner/i)).toBeVisible({
      timeout: 10000,
    });
    await expect(invoiceDialog.getByText(/2 páginas/i)).toBeVisible();
    await expect(invoiceDialog.getByRole('button', { name: /Previsualizar/i })).toBeVisible();
    await expect(invoiceDialog.getByRole('button', { name: /Reemplazar/i })).toBeVisible();

    // 16. Verificar que scanner_storage_path está presente para evitar re-subidas duplicadas
    const storagePathInput = invoiceDialog.locator('input[name="scanner_storage_path"]');
    await expect(storagePathInput).toHaveCount(1);
    const storagePathValue = await storagePathInput.inputValue();
    expect(storagePathValue).toContain('scans');

    await desktopContext.close();
    await mobileContext.close();
  });
});
