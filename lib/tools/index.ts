// lib/tools/index.ts
// Barrel que registra los tools de BATCH 1, BATCH 2, BATCH 3 y BATCH 4 al importarse.
// Importar este archivo desde el gateway/orchestrator asegura que el registry
// tenga los tool allowlisteados. No hace re-export de handlers para no acoplar.
import "@/lib/tools/projects/get-project-context";
import "@/lib/tools/stock/get-stock-availability";
import "@/lib/tools/procurement/get-material-need";
import "@/lib/tools/procurement/search-suppliers";
import "@/lib/tools/procurement/get-rfq";
import "@/lib/tools/procurement/get-rfq-responses";
import "@/lib/tools/procurement/compare-quotations";
import "@/lib/tools/procurement/create-rfq-draft";
import "@/lib/tools/procurement/prepare-purchase-order";
import "@/lib/tools/procurement/send-rfq";
import "@/lib/tools/procurement/issue-purchase-order";
// BATCH 4 — Agent Eyes
import "@/lib/tools/spreadsheet/get-spreadsheet-snapshot";
import "@/lib/tools/spreadsheet/read-spreadsheet-range";
import "@/lib/tools/spreadsheet/update-spreadsheet-rows";
import "@/lib/tools/spreadsheet/confirm-spreadsheet";
import "@/lib/tools/documents/get-document-content";
import "@/lib/tools/documents/extract-document-data";
// Auction Lab: lecturas redacted y mutaciones aprobables del módulo real.
import "@/lib/tools/erp/get-auction-overview";
import "@/lib/tools/erp/manage-auction-lab";
// ERP KNOWLEDGE V1 - contexto estatico y trazable, sin datos vivos.
import "@/lib/tools/knowledge/get-erp-knowledge";
// EMAIL V1 — drafts, frozen approvals and Gmail provider.
import "@/lib/tools/email/prepare-email";
import "@/lib/tools/email/send-email";
// ERP KNOWLEDGE / CONTEXT V2 — resolución humana, lecturas transversales y stock.
import "@/lib/tools/erp/resolve-erp-entity";
import "@/lib/tools/erp/get-project-inventory-overview";
import "@/lib/tools/erp/get-weekly-plan-overview";
import "@/lib/tools/erp/get-finance-overview";
import "@/lib/tools/erp/get-tender-overview";
import "@/lib/tools/erp/post-inventory-movement";
// ERP KNOWLEDGE V3 — acciones operativas reales con aprobación humana.
import "@/lib/tools/erp/manage-master-data";
import "@/lib/tools/erp/preview-weekly-plan";
import "@/lib/tools/erp/save-weekly-plan";
import "@/lib/tools/erp/manage-sales-document";
import "@/lib/tools/erp/create-invoice";
import "@/lib/tools/erp/manage-company-document";
import "@/lib/tools/erp/manage-inventory-operation";
import "@/lib/tools/erp/manage-climate-workday";
import "@/lib/tools/erp/manage-tender";
import "@/lib/tools/erp/manage-certificate";
import "@/lib/tools/erp/get-project-modeling-overview";
import "@/lib/tools/erp/manage-budget-item";
import "@/lib/tools/erp/manage-production-recipe";
// ERP KNOWLEDGE V4 — dominios auditados y lecturas reales adicionales.
import "@/lib/tools/erp/get-labor-subcontractor-overview";
import "@/lib/tools/erp/manage-labor-subcontractor";
import "@/lib/tools/erp/get-apu-overview";
import "@/lib/tools/erp/manage-apu-material";
import "@/lib/tools/erp/get-scanner-session-overview";
import "@/lib/tools/erp/get-project-operational-overview";
import "@/lib/tools/erp/get-inventory-overview";
import "@/lib/tools/erp/get-billing-overview";
import "@/lib/tools/erp/get-supplier-invoice-overview";
import "@/lib/tools/erp/manage-supplier-invoice";
import "@/lib/tools/erp/get-work-order-overview";
import "@/lib/tools/erp/manage-work-order";
import "@/lib/tools/erp/get-sifen-overview";
import "@/lib/tools/erp/manage-sifen-document";

// Re-export para uso directo en tests sin pasar por registry si se desea
export * from "@/lib/tools/projects/get-project-context";
export * from "@/lib/tools/stock/get-stock-availability";
export * from "@/lib/tools/procurement/get-material-need";
export * from "@/lib/tools/procurement/search-suppliers";
export * from "@/lib/tools/procurement/get-rfq";
export * from "@/lib/tools/procurement/get-rfq-responses";
export * from "@/lib/tools/procurement/compare-quotations";
export * from "@/lib/tools/procurement/create-rfq-draft";
export * from "@/lib/tools/procurement/prepare-purchase-order";
export * from "@/lib/tools/procurement/send-rfq";
export * from "@/lib/tools/procurement/issue-purchase-order";
export * from "@/lib/tools/spreadsheet/get-spreadsheet-snapshot";
export * from "@/lib/tools/spreadsheet/read-spreadsheet-range";
export * from "@/lib/tools/spreadsheet/update-spreadsheet-rows";
export * from "@/lib/tools/spreadsheet/confirm-spreadsheet";
export * from "@/lib/tools/documents/get-document-content";
export * from "@/lib/tools/documents/extract-document-data";
export * from "@/lib/tools/erp/get-auction-overview";
export * from "@/lib/tools/erp/manage-auction-lab";
export * from "@/lib/tools/knowledge/get-erp-knowledge";
export * from "@/lib/tools/email/prepare-email";
export * from "@/lib/tools/email/send-email";
export * from "@/lib/tools/erp/resolve-erp-entity";
export * from "@/lib/tools/erp/get-project-inventory-overview";
export * from "@/lib/tools/erp/get-weekly-plan-overview";
export * from "@/lib/tools/erp/get-finance-overview";
export * from "@/lib/tools/erp/get-tender-overview";
export * from "@/lib/tools/erp/post-inventory-movement";
export * from "@/lib/tools/erp/manage-master-data";
export * from "@/lib/tools/erp/preview-weekly-plan";
export * from "@/lib/tools/erp/save-weekly-plan";
export * from "@/lib/tools/erp/manage-sales-document";
export * from "@/lib/tools/erp/create-invoice";
export * from "@/lib/tools/erp/manage-company-document";
export * from "@/lib/tools/erp/manage-inventory-operation";
export * from "@/lib/tools/erp/manage-climate-workday";
export * from "@/lib/tools/erp/manage-tender";
export * from "@/lib/tools/erp/manage-certificate";
export * from "@/lib/tools/erp/get-project-modeling-overview";
export * from "@/lib/tools/erp/manage-budget-item";
export * from "@/lib/tools/erp/manage-production-recipe";
export * from "@/lib/tools/erp/get-labor-subcontractor-overview";
export * from "@/lib/tools/erp/manage-labor-subcontractor";
export * from "@/lib/tools/erp/get-apu-overview";
export * from "@/lib/tools/erp/manage-apu-material";
export * from "@/lib/tools/erp/get-scanner-session-overview";
export * from "@/lib/tools/erp/get-project-operational-overview";
export * from "@/lib/tools/erp/get-inventory-overview";
export * from "@/lib/tools/erp/get-billing-overview";
export * from "@/lib/tools/erp/get-supplier-invoice-overview";
export * from "@/lib/tools/erp/manage-supplier-invoice";
export * from "@/lib/tools/erp/get-work-order-overview";
export * from "@/lib/tools/erp/manage-work-order";
export * from "@/lib/tools/erp/get-sifen-overview";
export * from "@/lib/tools/erp/manage-sifen-document";
