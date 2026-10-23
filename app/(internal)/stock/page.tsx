import { StockSection } from "./stock-section";
import { getStockData } from "./section-action";

export default async function StockPage() {
  return <StockSection {...await getStockData()} />;
}
