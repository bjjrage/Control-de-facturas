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
// ERP KNOWLEDGE V1 - contexto estatico y trazable, sin datos vivos.
import "@/lib/tools/knowledge/get-erp-knowledge";
// EMAIL V1 — drafts, frozen approvals and Gmail provider.
import "@/lib/tools/email/prepare-email";
import "@/lib/tools/email/send-email";

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
export * from "@/lib/tools/knowledge/get-erp-knowledge";
export * from "@/lib/tools/email/prepare-email";
export * from "@/lib/tools/email/send-email";
