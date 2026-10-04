import { SalesSourceFormPage } from "@/app/(internal)/ventas/sales-source-form-page";

type SearchParams = {
  client?: string | string[];
  from?: string | string[];
  workOrder?: string | string[];
};

export default async function NuevaFacturaVentaPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  return <SalesSourceFormPage targetType="FACTURA" searchParams={await searchParams} />;
}
