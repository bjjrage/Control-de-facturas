/**
 * AUCTION SANDBOX (Auction Lab) — Domain types.
 *
 * The sandbox simulates the WORLD (room, phases, bids, ranking) and hands a
 * real AuctionState to the audited Auction Bot Core (lib/auction-bot).
 * Dependency direction is strictly: auction-sandbox → auction-bot. Never the
 * reverse. No auction-bot types are duplicated here.
 */

export type SandboxRoomStatus = 'DRAFT' | 'ACTIVE_NORMAL' | 'ACTIVE_RANDOM' | 'CLOSED';

export type SandboxParticipantKind = 'BOT' | 'HUMAN';

export type SandboxEventType =
  | 'ROOM_CREATED'
  | 'AUCTION_STARTED'
  | 'RANDOM_PHASE_STARTED'
  | 'BID_ACCEPTED'
  | 'BID_REJECTED'
  | 'BOT_DECISION'
  | 'POLICY_AUTHORIZED'
  | 'BOT_STOPPED'
  | 'AUCTION_CLOSED'
  | 'WINNER_DECLARED';

export interface SandboxRoom {
  id: string;
  empresa_id: string;
  created_by: string | null;
  title: string;
  scope: 'ITEM' | 'LOT' | 'TOTAL';
  group_id: string;
  status: SandboxRoomStatus;
  opening_price_pyg: number;
  minimum_decrement_pyg: number;
  normal_duration_seconds: number;
  random_min_seconds: number;
  random_max_seconds: number;
  started_at: string | null;
  random_started_at: string | null;
  /**
   * Secret while the auction is active. Lives ONLY in
   * auction_sandbox_room_private (no app SELECT). The engine keeps the field
   * for its reference implementation + tests; live app rows omit it.
   */
  random_close_at?: string | null;
  closed_at: string | null;
  next_sequence: number;
  bot_paused: boolean;
  /** Small runtime blob: ASSISTED pending candidate, last bot status, etc. */
  bot_runtime: SandboxBotRuntime;
  winner_participant_id: string | null;
  created_at: string;
}

export interface SandboxBotRuntime {
  pendingCandidate?: {
    pricePyg: number;
    basisObservedAt: string;
    policyVersion: number;
    decidedAt: string;
  } | null;
  /**
   * Canonical persisted shape (NEVER a bare string). Views expose only
   * `.action` (a string) — rendering this object directly would break React.
   */
  lastBotStatus?: {
    action: string;
    reasonCode: string;
    candidate: number | null;
    v: number;
  } | null;
}

export interface SandboxParticipant {
  id: string;
  room_id: string;
  kind: SandboxParticipantKind;
  display_alias: string;
  created_at: string;
}

export interface SandboxBid {
  id: string;
  room_id: string;
  participant_id: string;
  price_pyg: number;
  server_sequence: number;
  server_received_at: string;
  idempotency_key: string | null;
  accepted: boolean;
  rejection_reason: string | null;
}

export interface SandboxEvent {
  id: string;
  room_id: string;
  type: SandboxEventType;
  payload: Record<string, unknown>;
  server_sequence: number;
  created_at: string;
}

export interface SandboxPolicyVersion {
  room_id: string;
  version: number;
  policy_id: string;
  /** Immutable frozen-policy snapshot (AuctionPolicy + version metadata). */
  snapshot: Record<string, unknown>;
  fingerprint: string;
  authorized_by: string;
  authorized_at: string;
}

/** Everything the engine needs, loaded in one go (server-side only). */
export interface SandboxSnapshot {
  room: SandboxRoom;
  participants: SandboxParticipant[];
  /** Accepted bids only, caller should pass them ordered (price ASC, seq ASC). */
  bids: SandboxBid[];
}

export interface SandboxRankedEntry {
  rank: number;
  participant_id: string;
  kind: SandboxParticipantKind;
  display_alias: string;
  price_pyg: number;
  server_sequence: number;
  server_received_at: string;
}

export type BidRejectionCode =
  | 'ROOM_NOT_ACTIVE'
  | 'UNKNOWN_PARTICIPANT'
  | 'INVALID_PRICE'
  | 'NOT_DECREASING'
  | 'BELOW_MINIMUM_DECREMENT'
  | 'NOT_BELOW_OPENING';
