"use client";

import { DashboardView } from "./dashboard-view";
import { DashboardViewData } from "./section-action";

export function DashboardSection({ data }: { data: DashboardViewData }) {
  return <DashboardView data={data} />;
}
