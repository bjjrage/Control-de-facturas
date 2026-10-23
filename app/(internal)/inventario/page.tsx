import { InventarioGlobalSection } from "./inventario-global-section";
import { getInventarioData } from "./section-action";

export default async function InventarioGlobalPage() {
  return <InventarioGlobalSection {...await getInventarioData()} />;
}
