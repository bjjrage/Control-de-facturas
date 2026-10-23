"use server";

import { getProjectsPortfolioData } from "./portfolio-data";

export async function getProjectsData() {
  return getProjectsPortfolioData();
}
