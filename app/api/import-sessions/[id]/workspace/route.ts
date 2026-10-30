import { getImportWorkspace, saveImportWorkspace } from "@/app/(internal)/projects/import-workspace-actions";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getImportWorkspace(id);
  return session ? Response.json(session) : Response.json({ error: "Sesión no encontrada." }, { status: 404 });
}
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || !Number.isInteger(body.expectedRevision)) return Response.json({ error: "Falta la revisión del borrador." }, { status: 400 });
  const result = await saveImportWorkspace(id, body.expectedRevision, body.draft);
  return Response.json(result, { status: result.error ? 409 : 200 });
}
