import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const CANONICAL_DEMO_VERSION = "2026-09-21";

/**
 * IDs estables del dataset demo. No representan datos reales ni secretos.
 * Mantenerlos estables permite que el seed sea idempotente y que los tests
 * puedan enlazar entidades sin consultar por nombres frágiles.
 */
export const DEMO_IDS = {
  empresa: "10000000-0000-4000-8000-000000000001",
  provider: "10000000-0000-4000-8000-000000000101",
  providerReview: "10000000-0000-4000-8000-000000000102",
  client: "10000000-0000-4000-8000-000000000201",
  category: "10000000-0000-4000-8000-000000000301",
  product: "10000000-0000-4000-8000-000000000401",
  productCritical: "10000000-0000-4000-8000-000000000402",
  project: "10000000-0000-4000-8000-000000000501",
  budgetFoundation: "10000000-0000-4000-8000-000000000601",
  budgetFinishes: "10000000-0000-4000-8000-000000000602",
  budgetMaterials: "10000000-0000-4000-8000-000000000603",
  executionFoundation: "10000000-0000-4000-8000-000000000701",
  executionFinishes: "10000000-0000-4000-8000-000000000702",
  schedulePlan: "10000000-0000-4000-8000-000000000801",
  scheduleMonthOne: "10000000-0000-4000-8000-000000000811",
  scheduleMonthTwo: "10000000-0000-4000-8000-000000000812",
  scheduleMonthThree: "10000000-0000-4000-8000-000000000813",
  rfq: "10000000-0000-4000-8000-000000000901",
  rfqProvider: "10000000-0000-4000-8000-000000000911",
  attachment: "10000000-0000-4000-8000-000000000921",
  quote: "10000000-0000-4000-8000-000000000931",
  quoteVersion: "10000000-0000-4000-8000-000000000941",
  authorizedOrder: "10000000-0000-4000-8000-000000000951",
  invoice: "10000000-0000-4000-8000-000000000961",
  invoiceReview: "10000000-0000-4000-8000-000000000962",
  invoiceMatch: "10000000-0000-4000-8000-000000000971",
  invoiceException: "10000000-0000-4000-8000-000000000972",
  salesDocument: "10000000-0000-4000-8000-000000000981",
  salesItem: "10000000-0000-4000-8000-000000000982",
  salesReceipt: "10000000-0000-4000-8000-000000000983",
  licitacion: "10000000-0000-4000-8000-000000001001",
  licitacionLote: "10000000-0000-4000-8000-000000001011",
  licitacionItem: "10000000-0000-4000-8000-000000001021",
  licitacionOferente: "10000000-0000-4000-8000-000000001031",
  licitacionDocumento: "10000000-0000-4000-8000-000000001041",
  licitacionOferta: "10000000-0000-4000-8000-000000001051",
  licitacionOfertaItem: "10000000-0000-4000-8000-000000001061",
  empresaDocumento: "10000000-0000-4000-8000-000000001071",
  procurementEntity: "10000000-0000-4000-8000-000000001101",
  procurementProcess: "10000000-0000-4000-8000-000000001111",
  procurementLot: "10000000-0000-4000-8000-000000001121",
  procurementItem: "10000000-0000-4000-8000-000000001131",
  procurementSupplier: "10000000-0000-4000-8000-000000001141",
  procurementBid: "10000000-0000-4000-8000-000000001151",
  procurementAward: "10000000-0000-4000-8000-000000001161",
  procurementContract: "10000000-0000-4000-8000-000000001171",
  procurementDocument: "10000000-0000-4000-8000-000000001181",
  tenderFollowUp: "10000000-0000-4000-8000-000000001191",
  certificate: "10000000-0000-4000-8000-000000001201",
  certificateItem: "10000000-0000-4000-8000-000000001211",
} as const;

export const REQUIRED_DOMAINS = [
  "tenant",
  "users",
  "providers",
  "clients",
  "products",
  "projects",
  "budgets",
  "progress",
  "schedule",
  "procurement",
  "sales",
  "invoices",
  "receipts",
  "tenders",
  "tender-documents",
  "competitors",
  "certificates",
  "alerts",
] as const;

export type CanonicalAssetKind = "document" | "image" | "pdf" | "spreadsheet" | "ifc";

export const CANONICAL_ASSETS: ReadonlyArray<{
  kind: CanonicalAssetKind;
  path: string;
  purpose: string;
}> = [
  {
    kind: "pdf",
    path: "mocks/facturas-4/pdfs/factura-multi-item-01a-distribuidora-parcial.pdf",
    purpose: "Factura de compra con ítems y recepción parcial",
  },
  {
    kind: "pdf",
    path: "mocks/facturas-3/pdfs/facturamock001cooltech.pdf",
    purpose: "Documento de proveedor para flujos de compras",
  },
  {
    kind: "spreadsheet",
    path: "mocks/presupuesto-obra1/presupuesto-obra1.xlsx",
    purpose: "Presupuesto de obra para importación y regresión",
  },
  {
    kind: "ifc",
    path: "lib/bim/__tests__/fixtures/aurora-mixed-elements.ifc",
    purpose: "Modelo BIM ya existente para la suite BIM aislada",
  },
];

export const SEED_PLAN = [
  { domain: "tenant", tables: ["empresas", "profiles"] },
  { domain: "users", tables: ["auth.users", "profiles"] },
  { domain: "providers", tables: ["providers", "procurement_suppliers"] },
  { domain: "clients", tables: ["clients"] },
  { domain: "products", tables: ["categorias_producto", "productos", "stock_movimientos"] },
  { domain: "projects", tables: ["projects"] },
  { domain: "budgets", tables: ["budget_items"] },
  { domain: "progress", tables: ["execution_entries"] },
  { domain: "schedule", tables: ["project_schedule_plans", "project_schedule_plan_months"] },
  {
    domain: "procurement",
    tables: [
      "rfqs",
      "rfq_providers",
      "quotes",
      "quote_versions",
      "authorized_orders",
    ],
  },
  { domain: "sales", tables: ["sales_documents", "sales_document_items"] },
  { domain: "invoices", tables: ["invoices", "invoice_order_matches", "invoice_exceptions"] },
  { domain: "receipts", tables: ["sales_receipts"] },
  {
    domain: "tenders",
    tables: ["licitaciones", "procurement_processes", "empresa_licitacion_seguimiento"],
  },
  { domain: "tender-documents", tables: ["licitacion_documentos", "procurement_documents"] },
  { domain: "competitors", tables: ["licitacion_oferentes", "procurement_bids"] },
  { domain: "certificates", tables: ["project_certificates", "project_certificate_items"] },
  {
    domain: "alerts",
    tables: ["invoice_exceptions", "empresa_documentos"],
    note: "Las alertas del dashboard se derivan de excepciones y vencimientos; no existe una tabla de alertas artificial.",
  },
] as const;

export function validateCanonicalDemoManifest(repoRoot = process.cwd()): string[] {
  const errors: string[] = [];
  const ids = Object.values(DEMO_IDS);

  if (new Set(ids).size !== ids.length) {
    errors.push("DEMO_IDS contiene IDs repetidos.");
  }

  for (const id of ids) {
    if (!/^[0-9a-f-]{36}$/iu.test(id)) {
      errors.push(`ID inválido en DEMO_IDS: ${id}`);
    }
  }

  for (const asset of CANONICAL_ASSETS) {
    if (asset.path.includes(".env") || asset.path.includes("settings.local")) {
      errors.push(`Asset prohibido en el manifiesto: ${asset.path}`);
    }
    if (!existsSync(resolve(repoRoot, asset.path))) {
      errors.push(`Asset inexistente: ${asset.path}`);
    }
  }

  const planDomains = new Set(SEED_PLAN.map((item) => item.domain));
  for (const domain of REQUIRED_DOMAINS) {
    if (!planDomains.has(domain)) {
      errors.push(`Falta el dominio requerido en SEED_PLAN: ${domain}`);
    }
  }

  return errors;
}
