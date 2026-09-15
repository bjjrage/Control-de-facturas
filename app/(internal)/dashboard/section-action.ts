"use server";

import { unstable_noStore as noStore } from "next/cache";
import { getDashboardViewData, DashboardViewData } from "./data";

export type { DashboardViewData } from "./data";

export async function getDashboardData(): Promise<DashboardViewData> {
  noStore();
  return getDashboardViewData();
}
