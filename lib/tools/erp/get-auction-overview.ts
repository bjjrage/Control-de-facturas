// READ tool LEVEL 0 — vista redacted del Auction Lab real.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { buildWatchView, loadSandboxBundle } from "@/lib/auction-sandbox/server";

export const GetAuctionOverviewInputSchema = z.object({ room_id: z.string().uuid() });
export type GetAuctionOverviewInput = z.infer<typeof GetAuctionOverviewInputSchema>;

async function handler(ctx: AgentToolContext, input: GetAuctionOverviewInput, deps: { db: SupabaseClient }) {
  const loaded = await loadSandboxBundle(deps.db, input.room_id);
  if ("error" in loaded) throw new Error(loaded.error);
  if (loaded.bundle.room.empresa_id !== ctx.empresaId) throw new Error("La sala no pertenece a tu empresa.");
  const watch = buildWatchView(loaded.bundle, new Date().toISOString());
  return {
    room: watch.room,
    competitors: watch.ranking.map((row) => ({ rank: row.rank, display_alias: row.display_alias, kind: row.kind, price_pyg: row.price_pyg, server_sequence: row.server_sequence, server_received_at: row.server_received_at })),
    recent_bids: watch.recentBids,
    policy: watch.policy,
    bot_status: watch.botStatus,
    last_decision: watch.lastDecision,
    events: watch.timeline,
    result: watch.result,
    secrets_excluded: ["random_close_at", "competitor_token_hash", "observer_token_hash"],
  };
}

registerTool({
  name: "get_auction_overview",
  description: "Lee el estado real de una sala Auction Lab: fase, competidores, precios, histórico, policy visible, decisiones del bot y eventos redacted. Nunca expone tokens ni random_close_at y no inicia ni postura.",
  inputSchema: GetAuctionOverviewInputSchema,
  riskLevel: 0,
  requiredRoles: null,
  handler,
});

export const getAuctionOverviewTool = { handler, inputSchema: GetAuctionOverviewInputSchema };
