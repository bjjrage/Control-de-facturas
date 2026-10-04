import { requireProfile } from "@/lib/auth";
import { getDashboardViewData } from "./data";
import { DashboardView } from "./dashboard-view";

export default async function DashboardPage() {
  const profile = await requireProfile();
  try {
    const data = await getDashboardViewData(profile);
    return <DashboardView data={data} />;
  } catch(e) {
    console.error("dashboard source unavailable",e);
    return <div role="alert" className="rounded-lg border p-4 text-sm">Dashboard no disponible: no se pudieron verificar todas las fuentes. Reintentá la lectura. Los datos no disponibles no se muestran como cero.</div>;
  }
}
