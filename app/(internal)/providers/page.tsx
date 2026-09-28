import { BackButton } from "@/components/ui/back-button";
import { ProvidersSection } from "./providers-section";
import { getProvidersData } from "./section-action";

export default async function ProvidersPage() {
  const data = await getProvidersData();
  return (
    <div>
      <BackButton />
      <ProvidersSection initialData={data} />
    </div>
  );
}
