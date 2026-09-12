/**
 * E2E: Auction Lab básico (multipista manual).
 *
 * Flujo operador: /licitaciones → Auction Lab → crear sala DEMO RÁPIDA →
 * links de competidor/observer visibles → abrir sala.
 *
 * NOTA: este spec muta datos (crea una sala [E2E]). La config apunta al
 * deploy de producción compartido: ejecutarlo crea salas reales de prueba.
 */
import { test, expect } from '@playwright/test';

test.describe('Auction Lab', () => {
  test('operador crea una sala demo y ve los links', async ({ page }) => {
    await page.goto('/licitaciones');
    await page.waitForLoadState('networkidle', { timeout: 15_000 });

    await page.getByRole('link', { name: 'Auction Lab', exact: true }).click();
    await expect(page).toHaveURL(/\/licitaciones\/auction-lab/);

    await page.getByRole('button', { name: /demo rápida/i }).click();
    await page.getByLabel(/nombre/i).fill(`[E2E] ${Date.now()}`);
    await page.getByRole('button', { name: /crear subasta de prueba/i }).click();

    await expect(page.getByText(/sala creada/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/competidor/i).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /abrir sala/i }).click());

    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/ranking/i).first()).toBeVisible();
    await expect(page.getByText(/bot/i).first()).toBeVisible();
  });

  test('link de competidor inválido muestra ayuda, no 404 seco', async ({ page }) => {
    await page.goto('/auction-lab/join/' + '0'.repeat(43));
    await expect(page.getByText(/ya no es válido/i)).toBeVisible({ timeout: 15_000 });
  });

  test('link de observer inválido muestra ayuda, no 404 seco', async ({ page }) => {
    await page.goto('/auction-lab/watch/' + '0'.repeat(43));
    await expect(page.getByText(/ya no es válido/i)).toBeVisible({ timeout: 15_000 });
  });
});
