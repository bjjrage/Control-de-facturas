import { notFound } from "next/navigation";
import { getWarehousePortalContext } from "@/lib/inventory/warehouse-portal-data";
import { WarehousePortalClient } from "./warehouse-portal-client";

export const dynamic = "force-dynamic";

export default async function WarehousePortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const context = await getWarehousePortalContext(token);
  if (!context) notFound();

  return (
    <main className="min-h-screen bg-[var(--background)] px-3 py-6 sm:px-4 sm:py-8">
      <div className="mx-auto max-w-xl space-y-4">
        <WarehousePortalClient context={context} />
      </div>
    </main>
  );
}
