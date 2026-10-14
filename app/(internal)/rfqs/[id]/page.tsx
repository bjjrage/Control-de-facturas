import { RfqDetail } from "./rfq-detail";

export default async function RfqDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RfqDetail id={id} />;
}
