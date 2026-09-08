import { requireModule } from "@/lib/auth";
import { SalesList } from "@/app/(internal)/ventas/_components/sales-list";

type Filters = { month?: string; q?: string; client?: string; status?: string };

export default async function NotasCreditoPage({ searchParams }: { searchParams: Promise<Filters> }) {
  await requireModule("ventas", ["administracion", "admin"]);
  const params = await searchParams;
  return (
    <SalesList
      docType="NOTA_CREDITO"
      basePath="/notas-credito"
      title="Notas de Crédito"
      newLabel="Nueva NC"
      newHref="/ventas/nueva-nc"
      searchParams={params}
    />
  );
}
