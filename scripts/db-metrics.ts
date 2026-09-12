import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";

export interface DatabaseAuditedMetrics {
  processes: number;
  lots: number;
  items: number;
  suppliers: number;
  bids: number;
  awards: number;
  award_supplier_links: number;
  contracts: number;
  contract_supplier_links: number;
  amendments: number;
  documents: number;
  
  // Detailed dimensions
  embedded_amendments: number;
  extends_amendments: number;
  orphan_amendments: number;
  multi_supplier_contracts: number;
  multi_supplier_awards: number;
  consortia_count: number;
  sme_suppliers_count: number;
  base64_items_count: number;
  planning_only_count: number;
  currencies_distribution: Record<string, number>;
}

export async function collectDatabaseMetrics(): Promise<DatabaseAuditedMetrics> {
  const env = Object.fromEntries(
    fs.readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8")
      .split("\n")
      .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
  );

  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const { count: processes } = await supabase.from("procurement_processes").select("*", { count: "exact", head: true });
  const { count: lots } = await supabase.from("procurement_lots").select("*", { count: "exact", head: true });
  const { count: items } = await supabase.from("procurement_items").select("*", { count: "exact", head: true });
  const { count: suppliers } = await supabase.from("procurement_suppliers").select("*", { count: "exact", head: true });
  const { count: bids } = await supabase.from("procurement_bids").select("*", { count: "exact", head: true });
  const { count: awards } = await supabase.from("procurement_awards").select("*", { count: "exact", head: true });
  const { count: award_supplier_links } = await supabase.from("procurement_award_suppliers").select("*", { count: "exact", head: true });
  const { count: contracts } = await supabase.from("procurement_contracts").select("*", { count: "exact", head: true });
  const { count: contract_supplier_links } = await supabase.from("procurement_contract_suppliers").select("*", { count: "exact", head: true });
  const { count: amendments } = await supabase.from("procurement_contract_amendments").select("*", { count: "exact", head: true });
  const { count: documents } = await supabase.from("procurement_documents").select("*", { count: "exact", head: true });

  // 1. Multi-supplier contracts (CANONICAL GROUP BY HAVING COUNT > 1)
  const { data: contractLinks } = await supabase.from("procurement_contract_suppliers").select("contract_id");
  const contractSupplierCounts: Record<string, number> = {};
  for (const row of contractLinks || []) {
    contractSupplierCounts[row.contract_id] = (contractSupplierCounts[row.contract_id] || 0) + 1;
  }
  const multi_supplier_contracts = Object.values(contractSupplierCounts).filter(cnt => cnt > 1).length;

  // 2. Multi-supplier awards (CANONICAL GROUP BY HAVING COUNT > 1)
  const { data: awardLinks } = await supabase.from("procurement_award_suppliers").select("award_id");
  const awardSupplierCounts: Record<string, number> = {};
  for (const row of awardLinks || []) {
    awardSupplierCounts[row.award_id] = (awardSupplierCounts[row.award_id] || 0) + 1;
  }
  const multi_supplier_awards = Object.values(awardSupplierCounts).filter(cnt => cnt > 1).length;

  // 3. Amendments breakdown
  const { data: amendRows } = await supabase.from("procurement_contract_amendments").select("source_type, is_orphan");
  let embedded_amendments = 0;
  let extends_amendments = 0;
  let orphan_amendments = 0;
  for (const a of (amendRows || [])) {
    if (a.source_type === "EMBEDDED_AMENDMENT") embedded_amendments++;
    if (a.source_type === "EXTENDS_CONTRACT") extends_amendments++;
    if (a.is_orphan) orphan_amendments++;
  }

  // 4. Consortia / Consortium Suppliers
  const { count: consortia_count } = await supabase.from("procurement_suppliers")
    .select("*", { count: "exact", head: true })
    .ilike("nombre", "%CONSORCIO%");

  // 5. SME / SBE Suppliers
  const { count: sme_suppliers_count } = await supabase.from("procurement_suppliers")
    .select("*", { count: "exact", head: true })
    .in("tamano", ["sme", "micro", "pequeña", "mediana"]);

  // 6. Base64 items count
  const { data: base64Items } = await supabase.from("procurement_items").select("id").like("item_dncp_id", "%==%");
  const base64_items_count = base64Items?.length || 0;

  // 7. Planning only processes
  const { count: planning_only_count } = await supabase.from("procurement_processes")
    .select("*", { count: "exact", head: true })
    .eq("estado", "PLANNING");

  // 8. Currencies
  const { data: currRows } = await supabase.from("procurement_processes").select("moneda");
  const currencies_distribution: Record<string, number> = {};
  for (const c of (currRows || [])) {
    if (c.moneda) currencies_distribution[c.moneda] = (currencies_distribution[c.moneda] || 0) + 1;
  }

  return {
    processes: processes || 0,
    lots: lots || 0,
    items: items || 0,
    suppliers: suppliers || 0,
    bids: bids || 0,
    awards: awards || 0,
    award_supplier_links: award_supplier_links || 0,
    contracts: contracts || 0,
    contract_supplier_links: contract_supplier_links || 0,
    amendments: amendments || 0,
    documents: documents || 0,
    embedded_amendments,
    extends_amendments,
    orphan_amendments,
    multi_supplier_contracts,
    multi_supplier_awards,
    consortia_count: consortia_count || 0,
    sme_suppliers_count: sme_suppliers_count || 0,
    base64_items_count,
    planning_only_count: planning_only_count || 0,
    currencies_distribution,
  };
}

if (process.argv[1]?.includes("db-metrics")) {
  collectDatabaseMetrics().then(m => console.log("Audited Database Metrics:\n", JSON.stringify(m, null, 2))).catch(console.error);
}