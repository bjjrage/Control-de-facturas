import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { PDFParse } from 'pdf-parse';

const AUTH_FILE_A = path.join(__dirname, '.auth/admin.json');
const AUTH_FILE_B = path.join(__dirname, '.auth/tenantB.json');

test.describe('Mobile Document Scanner Companion E2E Flow', () => {
  test('Flujo completo: Desktop sesión -> Adversarial Tenant B Rejection -> Móvil QR (390x844) -> Captura P1 -> Filtro Documento -> Captura P2 -> Filtro B&N -> Reordenar -> Envío -> Recepción Desktop & Verificación PDF (2 páginas)', async ({
    browser,
  }) => {
    // 1. Contexto Desktop Autenticado como Tenant A (1366x768)
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

    // 3. Crear sesión mediante endpoint de API autenticado de Tenant A
    const createRes = await desktopPage.request.post('/api/scanner/session', {
      data: {
        contextType: 'invoice',
      },
    });

    if (!createRes.ok()) {
      const errText = await createRes.text();
      console.error(`CREATE SESSION FAILED: status=${createRes.status()}, body=${errText}`);
    }

    expect(createRes.ok()).toBeTruthy();
    const sessionData = await createRes.json();
    expect(sessionData.token).toBeDefined();
    expect(sessionData.pinCode).toBeDefined();
    expect(sessionData.sessionId).toBeDefined();

    // 4. TEST ADVERSARIAL CROSS-TENANT: Tenant B autenticado NO puede espiar la sesión de Tenant A
    const storageStateB = fs.existsSync(AUTH_FILE_B) ? AUTH_FILE_B : undefined;
    const tenantBContext = await browser.newContext({
      storageState: storageStateB,
    });

    // Intento 4.1: Tenant B consulta GET /api/scanner/status/[sessionA] -> DEBE recibir 404 (fail-closed)
    const tenantBStatusRes = await tenantBContext.request.get(`/api/scanner/status/${sessionData.sessionId}`);
    expect(tenantBStatusRes.status()).toBe(404);
    const tenantBData = await tenantBStatusRes.json();
    expect(tenantBData.storage_path).toBeUndefined();
    expect(tenantBData.signed_url).toBeUndefined();
    expect(tenantBData.context_id).toBeUndefined();

    // Intento 4.2: Tenant B intenta subir a /api/scanner/upload sin credencial móvil válida -> rechazado 401/403
    const tenantBUploadRes = await tenantBContext.request.post('/api/scanner/upload', {
      multipart: {
        file: {
          name: 'malicious.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'),
        },
        pageCount: '1',
      },
    });
    expect([401, 403]).toContain(tenantBUploadRes.status());
    await tenantBContext.close();

    // Intento 4.3: Intruso anónimo no autenticado
    const anonContext = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const anonRes = await anonContext.request.get(`/api/scanner/status/${sessionData.sessionId}`);
    expect([401, 404]).toContain(anonRes.status());
    await anonContext.close();

    // 5. Móvil abre la URL del QR: /scanner?t=TOKEN
    await mobilePage.goto(sessionData.joinUrl);

    // 6. Verificar que el móvil se conecta automáticamente y muestra el estado
    await expect(mobilePage.getByText('Conectado al ERP')).toBeVisible({ timeout: 10000 });
    await expect(mobilePage.getByRole('button', { name: /Abrir Cámara/i })).toBeVisible();

    // 7. Abrir cámara para Página 1
    await mobilePage.getByRole('button', { name: /Abrir Cámara/i }).click();

    // Imagen de prueba: buffer JPEG válido
    const sampleImageBuffer = Buffer.from(
      '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
      'base64'
    );

    // 8. Captura Página 1 via fallback de archivo
    let fileChooserPromise = mobilePage.waitForEvent('filechooser');
    await mobilePage.locator('button[title="Subir desde galería"]').click();
    let fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: 'factura-p1.jpg',
      mimeType: 'image/jpeg',
      buffer: sampleImageBuffer,
    });

    // 9. Pantalla de Ajustar Bordes (QuadEditor) - Página 1
    await expect(mobilePage.getByText(/Ajustar bordes/i)).toBeVisible({ timeout: 10000 });
    await mobilePage.getByRole('button', { name: /Confirmar/i }).click();

    // 10. Pantalla de Filtros (FilterSelector) - Página 1: seleccionar filtro Documento
    await expect(mobilePage.getByText(/Mejora de imagen/i)).toBeVisible({ timeout: 10000 });
    await mobilePage.getByRole('button', { name: /Documento/i }).click();
    await mobilePage.getByRole('button', { name: /Guardar página/i }).click();

    // 11. Pantalla de Lista Multipágina (PageList) - 1 página cargada
    await expect(mobilePage.getByText(/Documento Escaneado/i)).toBeVisible({ timeout: 10000 });
    await expect(mobilePage.getByText(/Página 1/i)).toBeVisible();

    // 12. Capturar Página 2: Click en "Agregar página"
    await mobilePage.getByRole('button', { name: /Agregar página/i }).click();

    // 13. Captura Página 2 via galería
    fileChooserPromise = mobilePage.waitForEvent('filechooser');
    await mobilePage.locator('button[title="Subir desde galería"]').click();
    fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: 'factura-p2.jpg',
      mimeType: 'image/jpeg',
      buffer: sampleImageBuffer,
    });

    // 14. Ajustar bordes - Página 2
    await expect(mobilePage.getByText(/Ajustar bordes/i)).toBeVisible({ timeout: 10000 });
    await mobilePage.getByRole('button', { name: /Confirmar/i }).click();

    // 15. Pantalla de Filtros - Página 2: seleccionar filtro B&N
    await expect(mobilePage.getByText(/Mejora de imagen/i)).toBeVisible({ timeout: 10000 });
    await mobilePage.getByRole('button', { name: /B\s*&\s*N/i }).click();
    await mobilePage.getByRole('button', { name: /Guardar página/i }).click();

    // 16. Pantalla de Lista Multipágina: 2 páginas
    await expect(mobilePage.getByText(/Documento Escaneado/i)).toBeVisible({ timeout: 10000 });
    await expect(mobilePage.getByText(/2 páginas listas/i)).toBeVisible({ timeout: 10000 });

    // 17. Reordenar páginas: Mover Página 2 arriba (invirtiendo el orden)
    const moveUpButtons = mobilePage.locator('button[title="Mover arriba"]:not([disabled])');
    await expect(moveUpButtons).toHaveCount(1);
    await moveUpButtons.click();

    // 18. Finalizar y Enviar al ERP
    await mobilePage.getByRole('button', { name: /Finalizar y Enviar al ERP/i }).click();

    // 19. Confirmación de éxito en móvil
    await expect(mobilePage.getByText(/¡Documento Enviado!/i)).toBeVisible({ timeout: 15000 });

    // 20. Verificar en Desktop que la sesión pasó a completed con exactamente 2 páginas y signed_url válida
    const statusRes = await desktopPage.request.get(`/api/scanner/status/${sessionData.sessionId}`);
    expect(statusRes.ok()).toBeTruthy();
    const statusData = await statusRes.json();
    expect(statusData.status).toBe('completed');
    expect(statusData.page_count).toBe(2);
    expect(statusData.signed_url).toBeDefined();
    expect(statusData.signed_url).toContain('http');

    // 21. Descargar el PDF generado y parsear con pdf-parse para verificar estrictamente 2 páginas físicas
    const pdfRes = await desktopPage.request.get(statusData.signed_url);
    expect(pdfRes.ok()).toBeTruthy();
    const pdfBuffer = await pdfRes.body();

    const parser = new PDFParse({ data: pdfBuffer });
    const parsedPdfInfo = await parser.getInfo();
    expect(parsedPdfInfo.total).toBe(2);

    await desktopContext.close();
    await mobileContext.close();
  });

  test('iPhone Safari Lifecycle: QR claim -> URL clean -> wait 3.5s -> reload/pageshow -> still connected without double-claim error', async ({
    browser,
  }) => {
    // 1. Contexto Desktop para crear la sesión
    const storageStateA = fs.existsSync(AUTH_FILE_A) ? AUTH_FILE_A : undefined;
    const desktopContext = await browser.newContext({
      storageState: storageStateA,
    });
    const desktopPage = await desktopContext.newPage();

    const createRes = await desktopPage.request.post('/api/scanner/session', {
      data: { contextType: 'invoice' },
    });
    expect(createRes.ok()).toBeTruthy();
    const sessionData = await createRes.json();
    expect(sessionData.joinUrl).toBeDefined();

    // 2. Contexto Móvil simulando iPhone Safari
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      storageState: { cookies: [], origins: [] },
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });
    const mobilePage = await mobileContext.newPage();

    // 3. Móvil abre la URL del QR: /scanner?t=...
    await mobilePage.goto(sessionData.joinUrl);

    // 4. Verificar que se conecta y muestra "Conectado al ERP"
    await expect(mobilePage.getByText(/Conectado al ERP/i)).toBeVisible({ timeout: 10000 });

    // 5. Verificar que la URL ya NO contiene ?t= ni ?token= (higienizada en caliente)
    const currentUrl = mobilePage.url();
    expect(currentUrl).not.toContain('?t=');
    expect(currentUrl).not.toContain('?token=');
    expect(currentUrl).not.toContain('&t=');
    expect(currentUrl).not.toContain('&token=');

    // 6. Esperar 3.5 segundos para simular el comportamiento exacto de iPhone
    await mobilePage.waitForTimeout(3500);

    // 7. Verificar que SIGUE conectado y NUNCA mostró error ni formulario PIN
    await expect(mobilePage.getByText(/Conectado al ERP/i)).toBeVisible();
    await expect(mobilePage.getByText(/Sesión de escaneo no encontrada o ya reclamada/i)).not.toBeVisible();
    await expect(mobilePage.getByText(/Código de sesión/i)).not.toBeVisible();

    // 8. Simular reload (o pageshow tras volver a la pestaña)
    await mobilePage.reload();

    // 9. Verificar que tras el reload se reanuda a través de la cookie y sigue "Conectado al ERP"
    await expect(mobilePage.getByText(/Conectado al ERP/i)).toBeVisible({ timeout: 10000 });
    await expect(mobilePage.getByRole('button', { name: /Abrir Cámara/i })).toBeVisible();
    await expect(mobilePage.getByText(/Sesión de escaneo no encontrada o ya reclamada/i)).not.toBeVisible();
    await expect(mobilePage.getByText(/Código de sesión/i)).not.toBeVisible();

    // 10. Desconectar voluntariamente
    await mobilePage.getByRole('button', { name: /Desconectar/i }).click();
    await expect(mobilePage.getByText(/Código de sesión/i)).toBeVisible({ timeout: 5000 });

    await desktopContext.close();
    await mobileContext.close();
  });

  test('Flujo PIN con sesión NUEVA independiente: Desktop crea sesión -> Móvil abre /scanner -> ingresa PIN -> Conectado', async ({
    browser,
  }) => {
    const storageStateA = fs.existsSync(AUTH_FILE_A) ? AUTH_FILE_A : undefined;
    const desktopContext = await browser.newContext({ storageState: storageStateA });
    const desktopPage = await desktopContext.newPage();

    const createRes = await desktopPage.request.post('/api/scanner/session', {
      data: { contextType: 'invoice' },
    });
    expect(createRes.ok()).toBeTruthy();
    const sessionData = await createRes.json();
    expect(sessionData.pinCode).toBeDefined();

    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      storageState: { cookies: [], origins: [] },
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });
    const mobilePage = await mobileContext.newPage();

    // Abrir /scanner directamente sin token
    await mobilePage.goto('/scanner');
    await expect(mobilePage.getByText(/Código de sesión/i)).toBeVisible({ timeout: 10000 });

    // Ingresar PIN de 6 dígitos
    const pinInput = mobilePage.locator('input[inputmode="numeric"]');
    await pinInput.fill(sessionData.pinCode);

    await mobilePage.getByRole('button', { name: /Vincular con ERP/i }).click();

    // Verificar que se conecta exitosamente
    await expect(mobilePage.getByText(/Conectado al ERP/i)).toBeVisible({ timeout: 10000 });
    await expect(mobilePage.getByRole('button', { name: /Abrir Cámara/i })).toBeVisible();

    await desktopContext.close();
    await mobileContext.close();
  });
});
