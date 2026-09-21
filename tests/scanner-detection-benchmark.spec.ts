import { test, expect } from "@playwright/test";

test("runs the browser V1 vs V2 scanner benchmark", async ({ page }) => {
  await page.goto("/scanner/benchmark");
  const outputLocator = page.locator("#scanner-benchmark-output");
  await expect.poll(async () => JSON.parse(await outputLocator.innerText()).status, { timeout: 30_000 }).toMatch(/ready|opencv-failed/);
  const output = await outputLocator.innerText();
  console.log(output);
  const parsed = JSON.parse(output) as { status: string; v1?: unknown; v2?: unknown };
  expect(["ready", "opencv-failed"]).toContain(parsed.status);
  if (parsed.status === "ready") {
    expect(parsed.v1).toBeDefined();
    expect(parsed.v2).toBeDefined();
  }
});
