import { requireProfile } from "@/lib/auth";
import { AuctionBotClient } from "./auction-bot-client";

export default async function AuctionBotPage() {
  await requireProfile(["comercial", "administracion", "admin"]);

  return <AuctionBotClient />;
}
