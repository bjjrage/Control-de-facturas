import { chromium } from "playwright";
import { readdirSync, unlinkSync } from "fs";
import { join, basename } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pdfsDir = join(__dirname, "pdfs");

const htmlFiles = readdirSync(pdfsDir).filter((f) => f.endsWith(".html"));

const browser = await chromium.launch();
const page = await browser.newPage();

for (const file of htmlFiles) {
  const htmlPath = join(pdfsDir, file);
  const pdfPath = join(pdfsDir, file.replace(".html", ".pdf"));
  await page.goto(`file:///${htmlPath.replace(/\\/g, "/")}`);
  await page.waitForLoadState("networkidle");
  await page.pdf({ path: pdfPath, format: "A4", printBackground: true });
  unlinkSync(htmlPath);
  console.log(`✓ ${basename(pdfPath)}`);
}

await browser.close();
console.log("Listo.");
