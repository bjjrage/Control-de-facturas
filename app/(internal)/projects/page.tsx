import { ProjectsSection } from "./projects-section";
import { getProjectsPortfolioData } from "./portfolio-data";

export default async function ProjectsPage() {
  return <ProjectsSection data={await getProjectsPortfolioData()} />;
}
