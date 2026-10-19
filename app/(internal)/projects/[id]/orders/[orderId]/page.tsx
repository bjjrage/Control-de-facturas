import { requirePlan } from "@/lib/auth";
import { OrderDetail } from "@/app/(internal)/orders/[id]/order-detail";

export default async function ProjectOrderPage({ params }: {
  params: Promise<{ id: string; orderId: string }>;
}) {
  await requirePlan("pro", ["administracion", "admin"]);
  const { id, orderId } = await params;
  return <OrderDetail id={orderId} projectId={id} />;
}
