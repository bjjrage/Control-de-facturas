import { requireProfile } from "@/lib/auth";
import { InteractiveGuide } from "@/components/instructivo/interactive-guide";
import { progressStorageKey } from "@/lib/instructivo/progress";

export const metadata = { title: "Instructivo interactivo · Control de Facturas" };

export default async function InstructivoPage() {
  const profile = await requireProfile();
  return <InteractiveGuide storageKey={progressStorageKey(profile.empresa_id,profile.id)} />;
}
