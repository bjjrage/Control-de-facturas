import { requireModule } from "@/lib/auth";
import { SalesList } from "@/app/(internal)/ventas/_components/sales-list";

type Filters = { month?: string; q?: string; client?: string; status?: string };

export default async function FacturasVentaPage({ searchParams }: { searchParams: Promise<Filters> }) {
  await requireModule("ventas", ["administracion", "admin"]);
  const params = await searchParams;
  return (
    <SalesList
      docType="FACTURA"
      basePath="/facturas-venta"
      title="Facturas de Venta"
      newLabel="Nueva factura"
      searchParams={params}
    />
  );
}
