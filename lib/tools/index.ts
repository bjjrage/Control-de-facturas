// lib/tools/index.ts
// Barrel que registra los tools de BATCH 1, BATCH 2 y BATCH 3 al importarse.
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