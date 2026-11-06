import { randomUUID } from "node:crypto";
import { requirePlan } from "@/lib/auth";
import { createEmptyProjectWorkbook } from "@/lib/projects/workspace-book";
import { ProjectWorkbookClient } from "../workbook-client";
import { deploymentInfo } from "@/lib/deployment-info";

export default async function NewProjectWorkspacePage() {
  await requirePlan("pro", ["administracion", "admin"]);
  const id = randomUUID();
  return <ProjectWorkbookClient id={id} name="Obra sin nombre" revision={0} workbook={createEmptyProjectWorkbook(id)} isNew isQa={deploymentInfo().environment === "preview"} />;
}
