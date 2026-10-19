import { requirePlan } from "@/lib/auth";
import { RfqDetail } from "@/app/(internal)/rfqs/[id]/rfq-detail";

export default async function ProjectRfqPage({ params }: {
  params: Promise<{ id: string; rfqId: string }>;
}) {
  await requirePlan("pro", ["administracion", "admin"]);
  const { id, rfqId } = await params;
  return <RfqDetail id={rfqId} projectId={id} />;
}
