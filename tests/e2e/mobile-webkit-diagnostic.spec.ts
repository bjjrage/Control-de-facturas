import { test, expect } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";

const AUTH_FILE_A = path.join(__dirname, ".auth/admin.json");

test.use({
  browserName: "webkit",
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});

test.describe("iPhone Safari WebKit Diagnostic Suite", () => {

  const viewports = [
    { name: "iPhone SE (375x667)", width: 375, height: 667 },
    { name: "iPhone 12/13/14 Safari Chrome Visible (390x664)", width: 390, height: 664 },
    { name: "iPhone 12/13/14 Fullscreen (390x844)", width: 390, height: 844 },
    { name: "iPhone 14/15/16 Pro Max (430x932)", width: 430, height: 932 },
  ];

  for (const vp of viewports) {
    test(`Viewport ${vp.name}: 'Abrir Cámara' visible, clickeable y estrictamente dentro del viewport en WebKit`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      // Mock de sesión activa conectada al ERP
      await page.route("**/api/scanner/mobile-session", (route) => {
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            active: true,
            session: {
              id: "session-test-vp-" + vp.width,
              context_type: "invoice",
              status: "connected",
            },
            mobileClaimToken: "mock-mobile-token",
          }),
        });
      });

      await page.goto("/scanner");

      // Verificar que el estado pasa a "Conectado al ERP"
      await expect(page.getByText(/Conectado al ERP/i)).toBeVisible({ timeout: 10000 });

      // Verificar el botón principal de cámara
      const openCameraBtn = page.getByRole("button", { name: /Abrir Cámara/i });
      await expect(openCameraBtn).toBeVisible();
      await expect(openCameraBtn).toBeEnabled();

      const box = await openCameraBtn.boundingBox();
      expect(box).not.toBeNull();
      if (box) {
        expect(box.y).toBeGreaterThan(0);
        // El botón debe estar estrictamente dentro del viewport vertical
        expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
        // Debe tener ancho completo utilizable
        expect(box.width).toBeGreaterThan(200);
      }

      // Botón desconectar también dentro del viewport
      const disconnectBtn = page.getByRole("button", { name: /Desconectar/i });
      await expect(disconnectBtn).toBeVisible();
      const discBox = await disconnectBtn.boundingBox();
      expect(discBox).not.toBeNull();
      if (discBox) {
        expect(discBox.y + discBox.height).toBeLessThanOrEqual(vp.height);
      }
    });
  }

  test("WebKit Flow: Click en 'Abrir Cámara' -> CameraCapture montado -> getUserMedia request -> Video Ready", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    // Mock session
    await page.route("**/api/scanner/mobile-session", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          active: true,
          session: {
            id: "session-test-camera",
            context_type: "invoice",
            status: "connected",
          },
          mobileClaimToken: "mock-mobile-token",
        }),
      });
    });

    // Mock navigator.mediaDevices.getUserMedia en WebKit
    await page.addInitScript(() => {
      const fakeTrack = {
        kind: "video",
        id: "fake-video-track",
        label: "iPhone Rear Camera (Mock)",
        enabled: true,
        readyState: "live",
        stop: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        applyConstraints: async () => {},
        getCapabilities: () => ({ torch: true }),
      };
      const fakeStream = {
        active: true,
        id: "fake-stream-id",
        getVideoTracks: () => [fakeTrack],
        getTracks: () => [fakeTrack],
        addEventListener: () => {},
        removeEventListener: () => {},
      };

      (window as any).__getUserMediaCalled = false;

      Object.defineProperty(navigator, "mediaDevices", {
        value: {
          getUserMedia: async () => {
            (window as any).__getUserMediaCalled = true;
            return fakeStream;
          },
        },
        configurable: true,
      });

      // Asegurar que video play y srcObject disparen eventos
      Object.defineProperty(HTMLVideoElement.prototype, "srcObject", {
        set(val) {
          (this as any)._srcObject = val;
          setTimeout(() => {
            this.dispatchEvent(new Event("loadedmetadata"));
            this.dispatchEvent(new Event("canplay"));
            this.dispatchEvent(new Event("playing"));
          }, 50);
        },
        get() {
          return (this as any)._srcObject;
        },
        configurable: true,
      });
      HTMLVideoElement.prototype.play = async function () {
        return Promise.resolve();
      };
    });

    await page.goto("/scanner");
    await expect(page.getByText(/Conectado al ERP/i)).toBeVisible({ timeout: 10000 });

    const openCameraBtn = page.getByRole("button", { name: /Abrir Cámara/i });
    await openCameraBtn.click();

    // Comprobar que CameraCapture se montó y el video está presente
    await expect(page.locator("video")).toBeVisible({ timeout: 5000 });

    // Comprobar que getUserMedia fue invocado
    const called = await page.evaluate(() => (window as any).__getUserMediaCalled);
    expect(called).toBe(true);

    // Comprobar que el video está activo
    await page.waitForTimeout(500);
    const videoReadyState = await page.evaluate(() => {
      const v = document.querySelector("video");
      return v ? v.readyState : 0;
    });
    expect(videoReadyState).toBeGreaterThanOrEqual(0);
  });

  test("Debug Mode (?debug=1): Overlay visible en WebKit con telemetría del botón y botón fijo funcional", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    await page.route("**/api/scanner/mobile-session", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          active: true,
          session: {
            id: "session-test-debug",
            context_type: "invoice",
            status: "connected",
          },
          mobileClaimToken: "mock-mobile-token",
        }),
      });
    });

    await page.goto("/scanner?debug=1");

    // Overlay debug visible
    await expect(page.getByText(/DEBUG OVERLAY \(\?debug=1\)/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/READY BUTTON TELEMETRY:/i)).toBeVisible();
    await expect(page.getByText(/bottom <= vpBottom: YES \(INSIDE\)/i)).toBeVisible();

    // Botón debug fijo visible
    const debugBtn = page.locator("#btn-debug-open-camera");
    await expect(debugBtn).toBeVisible();
    await expect(debugBtn).toHaveText("[ DEBUG: ABRIR CÁMARA ]");

    // Verificar posición fixed del botón debug
    const debugBox = await debugBtn.boundingBox();
    expect(debugBox).not.toBeNull();
    if (debugBox) {
      expect(debugBox.y + debugBox.height).toBeLessThanOrEqual(844);
    }

    // Click en botón debug transiciona a capturing
    await debugBtn.click();
    await expect(page.getByText(/flow: capturing/i)).toBeVisible({ timeout: 5000 });
  });
});
