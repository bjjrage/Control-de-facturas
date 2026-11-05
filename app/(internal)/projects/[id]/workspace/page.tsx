import { notFound } from "next/navigation";
import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { readAll } from "@/lib/cashflow/load";
import type { BudgetItem } from "@/lib/types";
import { BudgetWorkspace } from "../budget-workspace";
import { deploymentInfo } from "@/lib/deployment-info";

export default async function BudgetWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const { id } = await params;
  const db = await createClient();
  const { data: project } = await db.from("projects").select("id,name").eq("id", id).eq("empresa_id", profile.empresa_id).maybeSingle();
  if (!project) notFound();
  const items = await readAll<BudgetItem>((from, to) => db.from("budget_items").select("*", { count: "exact" }).eq("project_id", id).order("code").order("id").range(from, to));
  items.sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code, "es", { numeric: true }));
  return <BudgetWorkspace projectId={id} projectName={project.name} userId={profile.id} isQa={deploymentInfo().environment === "preview"} rows={items.map(item => ({
    id: item.id, code: item.code, description: item.description, unit: item.unit,
    quantity: item.quantity, unitPrice: item.unit_price, subtotal: item.subtotal,
  }))} />;
}
