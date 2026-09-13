import { requireProfile } from "@/lib/auth";
import { getDashboardViewData } from "./data";
import { DashboardView } from "./dashboard-view";

export default async function DashboardPage() {
  const profile = await requireProfile();
  const data = await getDashboardViewData(profile);
  return <DashboardView data={data} />;
}
