import Link from "next/link";
import { loadPrebidWorkspaceAction } from "@/lib/workspace/actions";
import { PrebidWorkspace } from "./workspace";

export default async function PrebidPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ version?: string }>;
}) {
  const { id } = await params; const { version } = await searchParams;
  const loaded = await loadPrebidWorkspaceAction(id, version);
  if (!loaded.data) return <main className="space-y-4"><Link href={`/licitaciones/${id}`}>Volver a licitación</Link><p role="alert">{loaded.error}</p></main>;
  return <PrebidWorkspace key={loaded.data.selectedVersion?.id ?? id} data={loaded.data} />;
}
