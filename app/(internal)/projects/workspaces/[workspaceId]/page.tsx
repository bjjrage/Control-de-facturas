import { notFound } from "next/navigation";
import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { IWorkbookData } from "@univerjs/presets";
import { ProjectWorkbookClient } from "../workbook-client";
import { deploymentInfo } from "@/lib/deployment-info";

export default async function ProjectWorkspacePage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const { workspaceId } = await params;
  const db = await createClient();
  const { data } = await db.from("project_workspaces").select("id,name,revision,workbook").eq("id", workspaceId).eq("empresa_id", profile.empresa_id).maybeSingle();
  if (!data) notFound();
  return <ProjectWorkbookClient id={data.id} name={data.name} revision={data.revision} workbook={data.workbook as IWorkbookData} isQa={deploymentInfo().environment === "preview"} />;
}
