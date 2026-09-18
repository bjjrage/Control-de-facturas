import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const AUTH_FILE = path.join(__dirname, '.auth/admin.json');

test.describe('Mobile Document Scanner Companion E2E Flow', () => {
  test('Flujo completo: Desktop sesión -> Móvil QR (390x844) -> Captura -> Edición -> Filtro -> Envío -> Recepción & Cross-Tenant Rejection', async ({
    browser,
  }) => {
    // 1. Contexto Desktop Autenticado (1366x768)
    const storageState = fs.existsSync(AUTH_FILE) ? AUTH_FILE : undefined;
    const desktopContext = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      storageState,
    });
    const desktopPage = await desktopContext.newPage();

    // 2. Contexto Móvil (390x844 - iPhone 12/13/14/15) sin sesión previa de ERP
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      permissions: ['camera'],
    });
    const mobilePage = await mobileContext.newPage();

    // 3. Crear sesión mediante endpoint de API autenticado
    const createRes = await desktopPage.request.post('/api/scanner/session', {
      data: {
        contextType: 'invoice',
      },
    });

    // Validar autenticación estricta: NO early return silencioso
    if (createRes.status() === 401) {
      throw new Error(
        'E2E Failure: Endpoint /api/scanner/session requiere autenticación válida. Verifique tests/e2e/.auth/admin.json o variable E2E_PASSWORD.'
      );
    }

    expect(createRes.ok()).toBeTruthy();
    const sessionData = await createRes.json();
    expect(sessionData.token).toBeDefined();
    expect(sessionData.pinCode).toBeDefined();
    expect(sessionData.sessionId).toBeDefined();

    // 4. Test Adversarial Cross-Tenant / Unauthenticated: Intruso no puede espiar la sesión
    const attackerContext = await browser.newContext();
    const attackerRes = await attackerContext.request.get(`/api/scanner/status/${sessionData.sessionId}`);
    // Intruso no autenticado o de otro tenant DEBE recibir 401 o 404 (nunca 200)
    expect([401, 404]).toContain(attackerRes.status());
    await attackerContext.close();

    // 5. Móvil abre la URL del QR: /scanner?t=TOKEN
    await mobilePage.goto(sessionData.joinUrl);

    // 6. Verificar que el móvil se conecta automáticamente y muestra el estado
    await expect(mobilePage.getByText('Conectado al ERP')).toBeVisible({ timeout: 10000 });
    await expect(mobilePage.getByRole('button', { name: /Abrir Cámara/i })).toBeVisible();

    // 7. Abrir cámara
    await mobilePage.getByRole('button', { name: /Abrir Cámara/i }).click();

    // 8. Simular captura o carga de foto mediante el input file fallback
    const sampleImageBuffer = Buffer.from(
      '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
      'base64'
    );

    const fileChooserPromise = mobilePage.waitForEvent('filechooser');
    await mobilePage.locator('button[title="Subir desde galería"]').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: 'factura-fisica.jpg',
      mimeType: 'image/jpeg',
      buffer: sampleImageBuffer,
    });

    // 9. Pantalla de Ajustar Bordes (QuadEditor)
    await expect(mobilePage.getByText(/Ajustar bordes/i)).toBeVisible({ timeout: 10000 });
    await mobilePage.getByRole('button', { name: /Confirmar/i }).click();

    // 10. Pantalla de Filtros (FilterSelector)
    await expect(mobilePage.getByText(/Mejora de imagen/i)).toBeVisible({ timeout: 10000 });
    await mobilePage.getByRole('button', { name: /Documento/i }).click();
    await mobilePage.getByRole('button', { name: /Guardar página/i }).click();

    // 11. Pantalla de Lista Multipágina (PageList)
    await expect(mobilePage.getByText(/Documento Escaneado/i)).toBeVisible({ timeout: 10000 });
    await expect(mobilePage.getByText(/Página 1/i)).toBeVisible();

    // 12. Finalizar y Enviar al ERP
    await mobilePage.getByRole('button', { name: /Finalizar y Enviar al ERP/i }).click();

    // 13. Confirmación de éxito en móvil
    await expect(mobilePage.getByText(/¡Documento Enviado!/i)).toBeVisible({ timeout: 15000 });

    // 14. Verificar en Desktop que la sesión pasó a completed y tiene signed_url
    const statusRes = await desktopPage.request.get(`/api/scanner/status/${sessionData.sessionId}`);
    expect(statusRes.ok()).toBeTruthy();
    const statusData = await statusRes.json();
    expect(statusData.status).toBe('completed');
    expect(statusData.page_count).toBe(1);
    expect(statusData.signed_url).toBeDefined();
    expect(statusData.signed_url).toContain('https://');

    await desktopContext.close();
    await mobileContext.close();
  });
});
