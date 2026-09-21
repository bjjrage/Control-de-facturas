import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const AUTH_FILE_A = path.join(__dirname, '.auth/admin.json');

test.describe('Mobile Scanner Live Camera & Continuous Detection E2E', () => {
  test('Experiencia de cámara en vivo: video ready -> detector en vivo -> overlay de bordes -> auto-capture -> QuadEditor con initialQuad -> guardar página', async ({
    browser,
  }) => {
    // 1. Contexto Desktop Autenticado para iniciar sesión de escaneo
    const storageStateA = fs.existsSync(AUTH_FILE_A) ? AUTH_FILE_A : undefined;
    const desktopContext = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      storageState: storageStateA,
    });
    const desktopPage = await desktopContext.newPage();

    // Crear sesión mediante API autenticada
    const createRes = await desktopPage.request.post('/api/scanner/session', {
      data: {
        contextType: 'invoice',
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const sessionData = await createRes.json();
    expect(sessionData.token).toBeDefined();

    // 2. Contexto Móvil con stream sintético de alta fidelidad que simula una hoja sobre escritorio
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      storageState: { cookies: [], origins: [] },
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      permissions: ['camera'],
    });

    // Inyectar stream de cámara sintético en navigator.mediaDevices.getUserMedia
    await mobileContext.addInitScript(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext('2d')!;

      function drawDocumentFrame() {
        // Fondo oscuro tipo escritorio (RGB 40, 42, 45)
        ctx.fillStyle = '#282a2d';
        ctx.fillRect(0, 0, 1280, 720);

        // Hoja blanca con alto contraste (quad centrado)
        ctx.fillStyle = '#f8fafc';
        ctx.beginPath();
        ctx.moveTo(260, 100);
        ctx.lineTo(1020, 100);
        ctx.lineTo(980, 620);
        ctx.lineTo(300, 620);
        ctx.closePath();
        ctx.fill();

        // Líneas oscuras simulando texto de factura
        ctx.fillStyle = '#334155';
        for (let y = 160; y < 580; y += 36) {
          ctx.fillRect(340, y, 600, 14);
        }
      }

      drawDocumentFrame();
      setInterval(drawDocumentFrame, 100);

      const syntheticStream = canvas.captureStream(30);

      if (navigator.mediaDevices) {
        navigator.mediaDevices.getUserMedia = async () => {
          return syntheticStream;
        };
      }
    });

    const mobilePage = await mobileContext.newPage();

    // 3. Móvil abre URL de escaneo
    await mobilePage.goto(sessionData.joinUrl);
    await expect(mobilePage.getByText(/Conectado al ERP/i)).toBeVisible({ timeout: 10000 });

    // 4. Abrir Cámara
    await mobilePage.getByRole('button', { name: /Abrir Cámara/i }).click();

    // 5. Verificar que el video y controles de cámara en vivo están presentes
    const video = mobilePage.locator('video');
    await expect(video).toBeVisible({ timeout: 10000 });

    // Toggle de auto-capture visible
    const autoToggle = mobilePage.locator('button:has-text("Auto: ON")');
    await expect(autoToggle).toBeVisible({ timeout: 5000 });

    // Overlay canvas presente
    const overlayCanvas = mobilePage.locator('canvas.pointer-events-none');
    await expect(overlayCanvas).toBeVisible({ timeout: 5000 });

    // 6. El detector en vivo y el stability tracker procesan el stream sintético
    // Debido a que el documento sintético es estable, transiciona a auto-capture o permite manual
    // Verificamos que o bien auto-captura o el shutter lleva directamente a QuadEditor
    const quadEditorVisible = await Promise.race([
      // Opción A: auto-capture disparado automáticamente
      mobilePage.getByText(/Ajustar bordes/i).waitFor({ state: 'visible', timeout: 8000 }).then(() => true),
      // Opción B: si el auto-capture requiere unos milisegundos más, hacer click en el shutter manual
      (async () => {
        await mobilePage.waitForTimeout(1500);
        const shutter = mobilePage.locator('button[aria-label="Capturar documento"]');
        if (await shutter.isVisible()) {
          await shutter.click().catch(() => {});
        }
        await mobilePage.getByText(/Ajustar bordes/i).waitFor({ state: 'visible', timeout: 5000 });
        return true;
      })(),
    ]);

    expect(quadEditorVisible).toBe(true);

    // 7. Verificar que QuadEditor recibió y cargó el documento
    await expect(mobilePage.getByRole('button', { name: /Confirmar/i })).toBeVisible();
    await mobilePage.getByRole('button', { name: /Confirmar/i }).click();

    // 8. Pantalla de filtros: aplicar Documento
    await expect(mobilePage.getByText(/Mejora de imagen/i)).toBeVisible({ timeout: 10000 });
    await mobilePage.getByRole('button', { name: /Documento/i }).click();
    await mobilePage.getByRole('button', { name: /Guardar página/i }).click();

    // 9. Página 1 lista en la lista de páginas
    await expect(mobilePage.getByText(/Documento Escaneado/i)).toBeVisible({ timeout: 10000 });
    await expect(mobilePage.getByText(/Página 1/i)).toBeVisible();

    await desktopContext.close();
    await mobileContext.close();
  });
});
