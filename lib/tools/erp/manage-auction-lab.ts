// ACTION tool LEVEL 2 — operaciones existentes del Auction Lab, siempre aprobables.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { actionResult } from "./action-utils";

export const ManageAuctionLabInputSchema = z.object({
  operation: z.enum(["start", "pause_bot", "resume_bot", "authorize_assisted_bid", "decline_limit_breach_bid", "finalize"]),
  room_id: z.string().uuid(),
  candidate_price_pyg: z.number().positive().optional(),
  policy_version: z.number().int().positive().optional(),
});
export type ManageAuctionLabInput = z.infer<typeof ManageAuctionLabInputSchema>;

async function handler(_ctx: AgentToolContext, input: ManageAuctionLabInput, _deps: { db: SupabaseClient }) {
  const actions = await import("@/app/(internal)/licitaciones/auction-lab/actions");
  let result: unknown;
  switch (input.operation) {
    case "start":
      result = await actions.startSandboxRoom(input.room_id);
      break;
    case "pause_bot":
      result = await actions.setSandboxBotPaused(input.room_id, true);
      break;
    case "resume_bot":
      result = await actions.setSandboxBotPaused(input.room_id, false);
      break;
    case "authorize_assisted_bid":
      result = await actions.authorizeAssistedBid(input.room_id);
      break;
    case "decline_limit_breach_bid":
      if (input.candidate_price_pyg === undefined || input.policy_version === undefined) throw new Error("Ceder una propuesta necesita precio y versión de policy.");
      result = await actions.declineLimitBreachBid(input.room_id, input.candidate_price_pyg, input.policy_version);
      break;
    case "finalize":
      result = await actions.finalizeSandboxRoom(input.room_id);
      break;
  }
  return { operation: input.operation, room_id: input.room_id, ...actionResult(result), message: "Operación de Auction Lab ejecutada por el servicio real; no mueve dinero." };
}

registerTool({
  name: "manage_auction_lab",
  description: "Inicia, pausa/reanuda el bot, autoriza una postura asistida, cede una propuesta o finaliza una sala Auction Lab real. Cada operación requiere aprobación humana; no regenera links ni expone tokens.",
  inputSchema: ManageAuctionLabInputSchema,
  riskLevel: 2,
  requiredRoles: ["administracion", "admin"],
  handler,
});

export const manageAuctionLabTool = { handler, inputSchema: ManageAuctionLabInputSchema };
