/**
 * AUCTION SANDBOX — AuctionState adapter.
 *
 * Converts the authoritative sandbox snapshot into a REAL AuctionState for
 * the audited Auction Bot Core. No auction-bot types are duplicated; the Core
 * stays untouched.
 *
 * Mapping notes (documented, not hidden):
 *  - DRAFT room → phase PRE_AUCTION + status ACTIVE, so the Core WAITs
 *    (it never bids before the opening by construction).
 *  - ACTIVE_NORMAL → NORMAL_BIDDING / timingWindow NOT_APPLICABLE.
 *  - ACTIVE_RANDOM → RANDOM_CLOSE with ENTRY_WINDOW while closeRisk is false
 *    ("prior to first possible close: repositioning") and CLOSE_RISK_WINDOW
 *    after. SAFE_WINDOW is intentionally unused in the sandbox.
 *  - CLOSED → phase CLOSED + status CLOSED (Core STOPs).
 *  - "Our" offers = the BOT participant's accepted bids.
 *  - observedAt = the server instant the snapshot was read (caller-supplied).
 */
import { AuctionState, RankedOffer } from '../auction-bot/types';
import { computePhase, rankBids } from './engine';
import { SandboxSnapshot } from './types';

export function snapshotToAuctionState(snapshot: SandboxSnapshot, nowIso: string): AuctionState {
  const nowMs = Date.parse(nowIso);
  const phase = computePhase(snapshot.room, nowMs);
  const bot = snapshot.participants.find((p) => p.kind === 'BOT');

  const aliasOf = (participantId: string) => {
    const p = snapshot.participants.find((x) => x.id === participantId);
    return { kind: (p?.kind ?? 'HUMAN') as 'BOT' | 'HUMAN', alias: p?.display_alias ?? '?' };
  };
  const ranking = rankBids(snapshot.bids, aliasOf);

  const rankedOffers: RankedOffer[] = ranking.map((entry) => ({
    rank: entry.rank,
    participantId: entry.participant_id,
    isOurOffer: bot !== undefined && entry.participant_id === bot.id,
    pricePyg: entry.price_pyg,
    timestamp: entry.server_received_at,
  }));

  const ourEntry = bot ? ranking.find((e) => e.participant_id === bot.id) ?? null : null;

  if (snapshot.room.status === 'DRAFT') {
    return {
      auctionId: snapshot.room.id,
      groupId: snapshot.room.group_id,
      scope: snapshot.room.scope,
      phase: 'PRE_AUCTION',
      timingWindow: 'NOT_APPLICABLE',
      closeRisk: false,
      status: 'ACTIVE',
      rankedOffers,
      ourRank: ourEntry?.rank ?? null,
      ourCurrentPricePyg: ourEntry?.price_pyg ?? null,
      observedAt: nowIso,
    };
  }

  if (phase.status === 'CLOSED') {
    return {
      auctionId: snapshot.room.id,
      groupId: snapshot.room.group_id,
      scope: snapshot.room.scope,
      phase: 'CLOSED',
      timingWindow: 'EXPIRED',
      closeRisk: false,
      status: 'CLOSED',
      rankedOffers,
      ourRank: ourEntry?.rank ?? null,
      ourCurrentPricePyg: ourEntry?.price_pyg ?? null,
      observedAt: nowIso,
    };
  }

  const isRandom = phase.status === 'ACTIVE_RANDOM';
  return {
    auctionId: snapshot.room.id,
    groupId: snapshot.room.group_id,
    scope: snapshot.room.scope,
    phase: isRandom ? 'RANDOM_CLOSE' : 'NORMAL_BIDDING',
    timingWindow: !isRandom ? 'NOT_APPLICABLE' : phase.closeRisk ? 'CLOSE_RISK_WINDOW' : 'ENTRY_WINDOW',
    closeRisk: phase.closeRisk,
    status: 'ACTIVE',
    rankedOffers,
    ourRank: ourEntry?.rank ?? null,
    ourCurrentPricePyg: ourEntry?.price_pyg ?? null,
    observedAt: nowIso,
  };
}
