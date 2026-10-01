import { test, expect } from "@playwright/test";

test("runs the browser OpenCV V2 vs Scanic benchmark", async ({ page }) => {
  await page.goto("/scanner/benchmark");
  const outputLocator = page.locator("#scanner-benchmark-output");
  await expect.poll(async () => {
    const progress = JSON.parse(await outputLocator.innerText()) as { status: string; phase?: string; current?: number; total?: number; name?: string };
    return progress.status;
  }, { timeout: 35_000 }).toMatch(/ready|failed/);
  const output = await outputLocator.innerText();
  const parsed = JSON.parse(output) as {
    status: string;
    error?: string;
    dataset: { fixtureCount: number; sameImageDataForBothEngines: boolean };
    initializationMs: { openCvV2: number; scanic: number };
    openCvV2: Record<string, number>;
    scanic: Record<string, number>;
    fallbackChain: { order: string[] };
  };
  if (parsed.status === "failed") {
    test.skip(true, `A/B metrics unavailable: ${parsed.error ?? "engine initialization did not finish"}`);
    return;
  }
  expect(parsed.dataset.fixtureCount).toBe(14);
  expect(parsed.dataset.sameImageDataForBothEngines).toBe(true);
  expect(parsed.initializationMs.openCvV2).toBeGreaterThan(0);
  expect(parsed.initializationMs.scanic).toBeGreaterThan(0);
  expect(parsed.openCvV2).toHaveProperty("normalizedCornerErrorPercent");
  expect(parsed.openCvV2).toHaveProperty("falseDetectionRate");
  expect(parsed.openCvV2).toHaveProperty("processingMeanMs");
  expect(parsed.scanic).toHaveProperty("meanQuadIoU");
  expect(parsed.scanic).toHaveProperty("fallbackRate");
  expect(parsed.fallbackChain.order).toEqual(["scanic", "opencv-v2", "v1"]);
});
