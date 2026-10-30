import { notFound, redirect } from "next/navigation";
import { getImportWorkspace, openImportedProjectWorkspace } from "../../import-workspace-actions";
import { ImportWorkspace } from "../../import-workspace";

export default async function ImportWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getImportWorkspace(id);
  if (!session) notFound();
  if (session.confirmedProjectId) redirect(await openImportedProjectWorkspace(session.confirmedProjectId));
  return <ImportWorkspace key={`${session.id}-${session.analyzedAt ?? "pending"}`} initialSession={session} />;
}
