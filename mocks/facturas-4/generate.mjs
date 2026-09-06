/**
 * Genera las facturas mock de la carpeta facturas-4 (HTML -> PDF con Playwright).
 *
 *   node mocks/facturas-4/generate.mjs
 *
 * Escenarios:
 *   - individuales        : 1 ítem, factura por el total de la OC
 *   - entregas parciales  : 2+ facturas que suman el total de una OC
 *   - multi-ítem          : varias líneas, con NOMBRES DISTINTOS a los de la OC
 *                           (prueba del matching semántico del worker)
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pdfsDir = join(__dirname, "pdfs");
mkdirSync(pdfsDir, { recursive: true });

const money = (n) => n.toLocaleString("es-PY");

const PROVIDERS = {
  distribuidora: {
    name: "Distribuidora Central SA",
    ruc: "8001234566",
    dir: "Ruta Mcal. Estigarribia Km 12, San Lorenzo",
    tel: "021-555-9876",
    timbrado: "23456789",
  },
  techoffice: {
    name: "TechOffice SRL",
    ruc: "8002345677",
    dir: "Av. Aviadores del Chaco 1250, Asunción",
    tel: "021-611-2200",
    timbrado: "34567890",
  },
  muebles: {
    name: "Muebles Modernos SA",
    ruc: "8004567899",
    dir: "Av. Eusebio Ayala 2340, Asunción",
    tel: "021-333-4455",
    timbrado: "45678901",
  },
  cooltech: {
    name: "CoolTech SRL",
    ruc: "8005678900",
    dir: "Av. España 1789, Asunción",
    tel: "021-202-8080",
    timbrado: "56789012",
  },
  limpieza: {
    name: "Limpieza Pro SA",
    ruc: "8003456788",
    dir: "Calle Última 555, Fernando de la Mora",
    tel: "021-509-1234",
    timbrado: "67890123",
  },
};

// ---------------------------------------------------------------------------
// Definición de las facturas
// ---------------------------------------------------------------------------
const INVOICES = [
  // ---- INDIVIDUALES (1 ítem, total de la OC) --------------------------------
  {
    file: "factura-individual-01-cooltech",
    provider: "cooltech",
    number: "001-002-0005001",
    date: "02/09/2026",
    oc: "OC-DEMO-011",
    ocDesc: "Notebooks y accesorios informáticos",
    note: "Entrega única. Factura por el total de la Orden de Compra OC-DEMO-011.",
    items: [
      { d: "Notebook 14\" + kit de accesorios (mouse, funda, base)", q: 5, pu: 2970000 },
    ],
  },
  {
    file: "factura-individual-02-distribuidora",
    provider: "distribuidora",
    number: "001-002-0005002",
    date: "03/09/2026",
    oc: "OC-MOCK-004",
    ocDesc: "Papel bond A4 75g resma x 500",
    note: "Entrega única. Factura por el total de la Orden de Compra OC-MOCK-004.",
    items: [
      { d: "Papel bond A4 75g — resma 500 hojas", q: 200, pu: 19000 },
    ],
  },

  // ---- ENTREGAS PARCIALES (2 facturas suman el total de la OC) -------------
  {
    file: "factura-parcial-limpieza-01",
    provider: "limpieza",
    number: "001-002-0005010",
    date: "05/09/2026",
    oc: "OC-DEMO-013",
    ocDesc: "Servicio de limpieza industrial — contrato 6 meses",
    note: "Primera entrega parcial (meses 1 a 3 de 6). Orden de Compra OC-DEMO-013.",
    items: [
      { d: "Servicio de limpieza industrial — meses 1 a 3", q: 3, pu: 1283333 },
    ],
  },
  {
    file: "factura-parcial-limpieza-02",
    provider: "limpieza",
    number: "001-002-0005011",
    date: "06/10/2026",
    oc: "OC-DEMO-013",
    ocDesc: "Servicio de limpieza industrial — contrato 6 meses",
    note: "Segunda entrega parcial (meses 4 a 6 de 6). Orden de Compra OC-DEMO-013.",
    items: [
      { d: "Servicio de limpieza industrial — meses 4 a 6", q: 3, pu: 1283334 },
    ],
  },
  {
    file: "factura-parcial-techoffice-01",
    provider: "techoffice",
    number: "001-002-0005020",
    date: "07/09/2026",
    oc: "OC-DEMO-015",
    ocDesc: "Insumos de oficina y papelería — suministro trimestral",
    note: "Primera entrega parcial (50%). Orden de Compra OC-DEMO-015.",
    items: [
      { d: "Insumos de oficina y papelería — lote parcial 1/2", q: 1, pu: 9900000 },
    ],
  },
  {
    file: "factura-parcial-techoffice-02",
    provider: "techoffice",
    number: "001-002-0005021",
    date: "21/09/2026",
    oc: "OC-DEMO-015",
    ocDesc: "Insumos de oficina y papelería — suministro trimestral",
    note: "Segunda entrega parcial (50% restante). Orden de Compra OC-DEMO-015.",
    items: [
      { d: "Insumos de oficina y papelería — lote parcial 2/2", q: 1, pu: 9900000 },
    ],
  },

  // ---- MULTI-ÍTEM (nombres distintos a los de la OC, a propósito) ----------
  // OC-MULTI-001 (Distribuidora, 13.200.000): DOS entregas parciales que la completan.
  {
    file: "factura-multi-item-01a-distribuidora-parcial",
    provider: "distribuidora",
    number: "001-002-0005030",
    date: "09/09/2026",
    oc: "OC-MULTI-001",
    ocDesc: "Materiales de obra — varios ítems",
    note: "Entrega PARCIAL 1 de 2: 60 de 100 bolsas de cemento y las 20 de arena. La varilla y el resto del cemento van en la próxima. Orden de Compra OC-MULTI-001.",
    items: [
      { d: "Cemento CP-40 x 50kg (bolsa)", q: 60, pu: 60000 },   // -> Cemento Portland tipo I 50kg  (60 de 100)
      { d: "Arena fina para revoque (m³)", q: 20, pu: 150000 },  // -> Arena lavada gruesa           (20 de 20)
    ],
  },
  {
    file: "factura-multi-item-01b-distribuidora-parcial",
    provider: "distribuidora",
    number: "001-002-0005031",
    date: "16/09/2026",
    oc: "OC-MULTI-001",
    ocDesc: "Materiales de obra — varios ítems",
    note: "Entrega PARCIAL 2 de 2: las 40 bolsas de cemento restantes y las 40 varillas. Completa la Orden de Compra OC-MULTI-001.",
    items: [
      { d: "Cemento CP-40 x 50kg (bolsa)", q: 40, pu: 60000 },   // -> Cemento Portland tipo I 50kg  (40 restantes)
      { d: "Varilla corrugada Ø12 x 12m", q: 40, pu: 105000 },   // -> Hierro de construcción Ø12mm barra 12m (40 de 40)
    ],
  },
  // OC-MULTI-002 (TechOffice, 36.300.000): UNA entrega completa.
  {
    file: "factura-multi-item-02-techoffice-completa",
    provider: "techoffice",
    number: "001-002-0005032",
    date: "10/09/2026",
    oc: "OC-MULTI-002",
    ocDesc: "Equipamiento informático — varios ítems",
    note: "Entrega COMPLETA de los 3 ítems. Orden de Compra OC-MULTI-002.",
    items: [
      { d: "Laptop Dell Latitude 5540 Core i5 16GB", q: 5, pu: 5000000 },        // -> Notebook Dell Latitude 15" i5 16GB
      { d: "Pantalla 24\" 1920x1080 IPS", q: 8, pu: 1200000 },                   // -> Monitor LED 24" Full HD
      { d: "Combo teclado + ratón inalámbrico Logitech", q: 10, pu: 170000 },    // -> Kit teclado + mouse inalámbrico
    ],
  },
  // OC-MULTI-003 (Muebles, 31.400.000): entrega con FALTANTE — llegan 8 sillas de 10.
  {
    file: "factura-multi-item-03-muebles-con-faltante",
    provider: "muebles",
    number: "001-002-0005033",
    date: "11/09/2026",
    oc: "OC-MULTI-003",
    ocDesc: "Mobiliario de oficina — varios ítems",
    note: "Entrega con FALTANTE: llegan 8 sillas de las 10 pedidas (backorder de 2). Escritorios y estantes completos. Orden de Compra OC-MULTI-003.",
    items: [
      { d: "Mesa de oficina en L 1.60 x 1.40 m", q: 4, pu: 2900000 },            // -> Escritorio ejecutivo en L 160x140 (4 de 4)
      { d: "Sillón operativo respaldo mesh con brazos", q: 8, pu: 1500000 },     // -> Silla ergonómica malla con apoyabrazos (8 de 10 — faltan 2)
      { d: "Estantería metálica 5 estantes 2.00 x 0.90", q: 6, pu: 800000 },     // -> Estante metálico 5 niveles 200x90 (6 de 6)
    ],
  },
];

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
function renderHTML(inv) {
  const p = PROVIDERS[inv.provider];
  const rows = inv.items
    .map(
      (it) => `
      <tr>
        <td>${it.d}</td>
        <td class="c">${money(it.q)}</td>
        <td class="r">${money(it.pu)}</td>
        <td class="r">${money(it.q * it.pu)}</td>
      </tr>`
    )
    .join("");
  const total = inv.items.reduce((s, it) => s + it.q * it.pu, 0);

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #1a1a1a; margin: 0; padding: 34px 40px; font-size: 13px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #222; padding-bottom: 14px; }
  .emisor h1 { margin: 0 0 4px; font-size: 19px; }
  .emisor p { margin: 1px 0; font-size: 12px; color: #333; }
  .doc { text-align: right; }
  .doc .tit { font-size: 22px; font-weight: 700; letter-spacing: 1px; }
  .doc .num { font-size: 15px; margin-top: 2px; }
  .doc .tmb { font-size: 11px; color: #555; margin-top: 6px; }
  .ref { background: #fff5cc; border: 1px solid #e6c200; border-radius: 4px; padding: 8px 12px; margin: 16px 0; font-size: 13px; }
  .ref strong { font-size: 14px; }
  .grid { display: flex; gap: 30px; margin: 14px 0 18px; }
  .grid > div { flex: 1; }
  .grid h3 { margin: 0 0 5px; font-size: 11px; text-transform: uppercase; color: #888; letter-spacing: .5px; }
  .grid p { margin: 2px 0; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th { background: #222; color: #fff; padding: 8px 10px; text-align: left; font-size: 12px; }
  th.c, td.c { text-align: center; }
  th.r, td.r { text-align: right; }
  td { padding: 8px 10px; border-bottom: 1px solid #ddd; }
  .tot { margin-top: 14px; margin-left: auto; width: 300px; }
  .tot tr td { border: none; padding: 4px 10px; }
  .tot .grand td { border-top: 2px solid #222; font-weight: 700; font-size: 15px; padding-top: 8px; }
  .obs { margin-top: 26px; font-size: 12px; color: #444; border-top: 1px solid #ddd; padding-top: 10px; }
  </style></head><body>
    <div class="head">
      <div class="emisor">
        <h1>${p.name}</h1>
        <p>RUC: ${p.ruc}</p>
        <p>${p.dir}</p>
        <p>Tel: ${p.tel}</p>
      </div>
      <div class="doc">
        <div class="tit">FACTURA</div>
        <div class="num">${inv.number}</div>
        <div class="tmb">Timbrado N° ${p.timbrado}<br>Fecha: ${inv.date}</div>
      </div>
    </div>

    <div class="ref"><strong>Referencia OC: ${inv.oc}</strong> — ${inv.ocDesc}</div>

    <div class="grid">
      <div>
        <h3>Datos del cliente</h3>
        <p>niu.pack S.A.</p>
        <p>RUC: 80099887-6</p>
        <p>Condición: Crédito 30 días</p>
      </div>
      <div>
        <h3>Datos de emisión</h3>
        <p>Fecha: ${inv.date}</p>
        <p>Moneda: Guaraníes (PYG)</p>
        <p>Precios con IVA incluido</p>
      </div>
    </div>

    <table>
      <thead>
        <tr><th>Descripción</th><th class="c">Cant.</th><th class="r">P. Unitario</th><th class="r">Subtotal</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <table class="tot">
      <tr class="grand"><td>TOTAL A PAGAR</td><td class="r">Gs. ${money(total)}</td></tr>
    </table>

    <div class="obs"><strong>Observaciones:</strong> ${inv.note}</div>
  </body></html>`;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------
const browser = await chromium.launch();
const page = await browser.newPage();

for (const inv of INVOICES) {
  const htmlPath = join(pdfsDir, `${inv.file}.html`);
  const pdfPath = join(pdfsDir, `${inv.file}.pdf`);
  writeFileSync(htmlPath, renderHTML(inv), "utf-8");
  await page.goto(`file:///${htmlPath.replace(/\\/g, "/")}`);
  await page.waitForLoadState("networkidle");
  await page.pdf({ path: pdfPath, format: "A4", printBackground: true });
  unlinkSync(htmlPath);
  const total = inv.items.reduce((s, it) => s + it.q * it.pu, 0);
  console.log(`✓ ${inv.file}.pdf  (${inv.oc}, ${inv.items.length} ítem/s, Gs. ${money(total)})`);
}

await browser.close();
console.log(`\nListo — ${INVOICES.length} facturas en mocks/facturas-4/pdfs/`);
