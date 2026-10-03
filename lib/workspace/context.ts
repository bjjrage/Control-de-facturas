import { z } from "zod";

/** One owner, same engines. Tender history never changes owner after award. */
export const workspaceContextSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("TENDER"), id: z.uuid() }),
  z.object({ kind: z.literal("PROJECT"), id: z.uuid() }),
]);
export type WorkspaceContext = z.infer<typeof workspaceContextSchema>;
export function ownerColumn(context: WorkspaceContext): "tender_id" | "project_id" {
  return context.kind === "TENDER" ? "tender_id" : "project_id";
}
export function ownerValues(context: WorkspaceContext) {
  return { project_id: context.kind === "PROJECT" ? context.id : null,
    tender_id: context.kind === "TENDER" ? context.id : null };
}
export function workspacePath(context: WorkspaceContext) {
  return context.kind === "TENDER" ? `/licitaciones/${context.id}/prebid` : `/projects/${context.id}`;
}
