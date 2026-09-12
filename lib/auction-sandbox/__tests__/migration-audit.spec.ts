/**
 * AUCTION SANDBOX — Static migration audit (no DB available).
 *
 * 0068 is APPLIED to the live project; 0070 (policy-bound submit) ships in
 * this branch and MUST be pushed (`supabase db push`) before deploying app
 * code. Skew is fail-closed by construction: new-code + old-DB errors on the
 * unknown 5th arg inside rpcSubmit's try/catch (no write, liveness stall
 * only); old-code + new-DB behaves exactly as pre-0070 (param defaults
 * NULL). Ship DB first, then app — see the rollout checklist in 0070.
 * These tests audit the migration FILES statically. If any assertion fails,
 * the migrations are NOT safe to apply.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// Strip SQL comments (line AND block) so assertions target real code.
// A mutant hiding code in a block comment (e.g. /* security definer */)
// must not satisfy a presence pin.
const stripSql = (s: string): string =>
  s
    .split('\n')
    .map((l) => (l.includes('--') ? l.slice(0, l.indexOf('--')) : l))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
const sqlRaw = readFileSync(resolve(ROOT, 'supabase', 'migrations', '0068_auction_sandbox.sql'), 'utf8');
const sql = stripSql(sqlRaw);
const sql70Raw = readFileSync(resolve(ROOT, 'supabase', 'migrations', '0070_auction_sandbox_policy_bound_submit.sql'), 'utf8');
const sql70 = stripSql(sql70Raw);

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf8');
}

describe('0068 static safety audit', () => {
  it('bid RPC takes NO client timestamp (server clock only)', () => {
    expect(sql).not.toMatch(/p_now_iso/);
    expect(sql).toMatch(/v_now\s+timestamptz\s*:=\s*clock_timestamp\(\)/);
    // submit inserts server_received_at from the DB clock variable. Slice
    // with CODE markers (comment markers are stripped above — a comment-only
    // end marker yields indexOf -1 and a false-green slice of the whole file).
    const submitFn = sql.slice(
      sql.indexOf('create or replace function public.submit_sandbox_bid('),
      sql.indexOf('create or replace function public.append_sandbox_event(')
    );
    expect(submitFn.length).toBeGreaterThan(100);
    expect(submitFn).toContain('server_received_at');
    expect(submitFn).toContain('v_now');
  });

  it('SECURITY DEFINER RPCs are revoked from authenticated/anon/public, granted to service_role only', () => {
    for (const fn of ['submit_sandbox_bid', 'append_sandbox_event', 'advance_sandbox_room', 'force_close_sandbox_room']) {
      expect(sql).toContain(`revoke all on function public.${fn}`);
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${fn}[^;]*authenticated`));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${fn}[^;]*to service_role`));
    }
    expect(sql).not.toMatch(/grant execute on function public\.\w+\([^;]*to authenticated/);
    // No anon/public execution either — case/whitespace-tolerant (SQL is
    // case-insensitive; a `GRANT … TO ANON` or double-spaced variant must
    // also fail). An unauthenticated SECURITY DEFINER grant bypasses all
    // empresa/token/MANAGE scoping.
    expect(sql).not.toMatch(/grant\s+execute\s+on\s+function\s+public\.\w+\([^;]*to\s+anon/i);
    expect(sql).not.toMatch(/grant\s+execute\s+on\s+function\s+public\.\w+\([^;]*to\s+public[,\s;]/i);
    // No client-clock smuggling under a renamed param.
    expect(sql).not.toMatch(/p_client/i);
  });

  it('random_close_at lives ONLY in the private table (never in rooms)', () => {
    expect(sql).toMatch(/create table if not exists public\.auction_sandbox_room_private/);
    const start = sql.indexOf('create table if not exists public.auction_sandbox_rooms');
    const roomsDef = sql.slice(start, sql.indexOf('\n);', start));
    expect(roomsDef).not.toMatch(/random_close_at/);
    // No ALTER smuggling the secret into an RLS-readable table later —
    // variant-tolerant (IF NOT EXISTS / quoted identifiers must also fail).
    expect(sql).not.toMatch(/add\s+column\s+(if\s+not\s+exists\s+)?["']?random_close_at/i);
    // No SELECT policy on the private table (deny by default) — and RLS must
    // actually be enabled (an empty slice from a deleted line must not pass).
    expect(sql).toContain('auction_sandbox_room_private enable row level security');
    const privStart = sql.indexOf('auction_sandbox_room_private enable row level security');
    expect(privStart).toBeGreaterThan(-1);
    const privSection = sql.slice(privStart, sql.indexOf('create table if not exists public.auction_sandbox_participants'));
    expect(privSection).not.toMatch(/create policy/);
  });

  it('participants RLS: comercial can SELECT but never INSERT/UPDATE/DELETE', () => {
    expect(sql).not.toMatch(/sandbox_participants_all/);
    expect(sql).toMatch(/sandbox_participants_select/);
    const selectBlock = sql.slice(sql.indexOf('sandbox_participants_select'), sql.indexOf('sandbox_participants_write'));
    expect(selectBlock).toContain("'comercial'");
    // Only the write policies, all restricted to admin roles — checked over
    // the whole file (a second INSERT policy lives past sandbox_bids_select,
    // outside the slice above; every participants write policy is pinned).
    const writeSection = sql.slice(sql.indexOf('sandbox_participants_write'), sql.indexOf('create policy sandbox_bids_select'));
    expect(writeSection).toMatch(/sandbox_participants_write/);
    expect(writeSection).toMatch(/sandbox_participants_update/);
    expect(writeSection).toMatch(/sandbox_participants_delete/);
    expect(writeSection).not.toContain("'comercial'");
    const writePolicies = sql
      .toLowerCase()
      .split('create policy ')
      .slice(1)
      .filter((seg) => /^sandbox_participants_(write|update|delete|insert)/.test(seg));
    expect(writePolicies.length).toBeGreaterThanOrEqual(4);
    for (const seg of writePolicies) {
      expect(seg).not.toContain("'comercial'");
    }
  });

  it('sequence allocation is lock-guarded in SQL (FOR UPDATE + single bump)', () => {
    const forUpdates = sql.match(/for update/g) ?? [];
    expect(forUpdates.length).toBeGreaterThanOrEqual(4); // submit, append, advance, force_close
    // Per-RPC (not just global): removing the lock from any one allocator
    // must fail, so slice each function body and require its own lock.
    const bodyOf = (fn: string): string => {
      const start = sql.indexOf(`create or replace function public.${fn}(`);
      expect(start).toBeGreaterThan(-1);
      const next = sql.indexOf('create or replace function public.', start + 10);
      return sql.slice(start, next === -1 ? undefined : next);
    };
    for (const fn of ['submit_sandbox_bid', 'append_sandbox_event', 'advance_sandbox_room', 'force_close_sandbox_room']) {
      expect(`${fn}: ${bodyOf(fn)}`).toMatch(/for update/);
    }
    expect(sql).toMatch(/on conflict \(room_id\) do nothing/); // single-winner random roll
  });

  it('no app-level next_sequence math remains in Auction Lab code', () => {
    const files = [
      'app/(internal)/licitaciones/auction-lab/actions.ts',
      'app/auction-lab/join/[token]/actions.ts',
      'app/auction-lab/watch/[token]/actions.ts',
      'lib/auction-sandbox/server.ts',
    ];
    for (const f of files) {
      const src = read(f);
      expect(`${f}: ${src}`).not.toMatch(/next_sequence\s*\+\s*1|next_sequence:\s*seq|next_sequence = stale/i);
      expect(src).not.toContain('p_now_iso');
    }
  });

  it('no direct inserts into events/bids in app code (allocator + RPC only)', () => {
    const files = [
      'app/(internal)/licitaciones/auction-lab/actions.ts',
      'app/auction-lab/join/[token]/actions.ts',
      'app/auction-lab/watch/[token]/actions.ts',
    ];
    for (const f of files) {
      const src = read(f);
      // Direct event inserts were removed with the events_insert policy:
      // everything flows through append_sandbox_event. Ban upsert/backtick/
      // spaced variants too — any direct write bypasses the allocator
      // (`admin.from ('…').insert(…)` is valid JS and must also fail).
      expect(src).not.toMatch(/from\s*\(\s*['"`]auction_sandbox_events['"`]\s*\)\s*\.\s*(insert|upsert)/);
      expect(src).not.toMatch(/from\s*\(\s*['"`]auction_sandbox_bids['"`]\s*\)\s*\.\s*(insert|upsert)/);
    }
    // ...except the RPC allocator call itself.
    const ops = read('app/(internal)/licitaciones/auction-lab/actions.ts');
    expect(ops).toContain('append_sandbox_event');
  });

  it('advance failure blocks submit paths (poll, assisted, auto-submit)', () => {
    const ops = read('app/(internal)/licitaciones/auction-lab/actions.ts');
    const guards = ops.match(/if \('error' in advanced\)/g) ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(3);
  });

  it('authorization split: mutating actions require MANAGE, read-only never touches admin', () => {
    const ops = read('app/(internal)/licitaciones/auction-lab/actions.ts');
    const starts: Array<{ name: string; at: number }> = [];
    const re = /export async function (\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(ops)) !== null) starts.push({ name: m[1], at: m.index });
    const bodyOf = (name: string): string => {
      const i = starts.findIndex((s) => s.name === name);
      expect(i).toBeGreaterThan(-1);
      return ops.slice(starts[i].at, i + 1 < starts.length ? starts[i + 1].at : undefined);
    };
    // Every exported mutating action gates on MANAGE_ROLES (directly or via
    // manageOperatorBundle). True DB-backed authz tests need a database;
    // this pins the gate structure statically.
    for (const fn of [
      'createSandboxRoom',
      'startSandboxRoom',
      'authorizeSandboxPolicy',
      'pollOperatorRoom',
      'authorizeAssistedBid',
      'setSandboxBotPaused',
      'finalizeSandboxRoom',
      'regenerateSandboxLinks',
    ]) {
      expect(`${fn}: ${bodyOf(fn)}`).toMatch(/MANAGE_ROLES|manageOperatorBundle/);
    }
    // The read-only view path must never create or receive an admin client.
    const readBody = bodyOf('getOperatorRoomState');
    expect(readBody).not.toContain('createAdminClient');
    expect(readBody).not.toMatch(/\badmin\b/);
    expect(readBody).toContain('readOperatorBundle');
  });
  it('app read lists never include random_close_at', () => {
    const server = read('lib/auction-sandbox/server.ts');
    const colsDef = server.slice(server.indexOf('const ROOM_COLS'), server.indexOf('NOTE: random_close_at'));
    expect(colsDef.length).toBeGreaterThan(0);
    expect(colsDef).not.toContain('random_close_at');
  });
  it('token hashes are only written at creation/regeneration (never selected/returned)', () => {
    // The only legitimate writers: createSandboxRoom (initial hashes) and
    // regenerateSandboxLinks (rotation), both admin-gated server actions.
    // Nobody may SELECT or return hashes.
    const src = read('app/(internal)/licitaciones/auction-lab/actions.ts');
    const endOf = (marker: string, from: number) => {
      const i = src.indexOf('\nexport ', from);
      return i === -1 ? src.length : i;
    };
    const createStart = src.indexOf('export async function createSandboxRoom');
    const regenStart = src.indexOf('export async function regenerateSandboxLinks');
    const writers = src.slice(createStart, endOf('x', createStart + 10)) + src.slice(regenStart, endOf('x', regenStart + 10));
    const rest = src.slice(0, createStart) + src.slice(endOf('x', createStart + 10), regenStart) + src.slice(endOf('x', regenStart + 10));
    expect(writers).toMatch(/competitor_token_hash|observer_token_hash/);
    expect(rest).not.toMatch(/competitor_token_hash|observer_token_hash/);
    expect(src).not.toMatch(/\.select\([^)]*token_hash/);
    for (const f of [
      'lib/auction-sandbox/server.ts',
      'app/auction-lab/join/[token]/actions.ts',
      'app/auction-lab/watch/[token]/actions.ts',
    ]) {
      expect(read(f)).not.toMatch(/competitor_token_hash|observer_token_hash/);
    }
  });
});

describe('0070 static safety audit — policy-bound submit', () => {
  it('submit carries an optional expected policy version (human path unaffected)', () => {
    expect(sql70).toContain('p_expected_policy_version integer default null');
    expect(sql70).not.toMatch(/p_now_iso/);
  });

  it('a newer persisted version rejects with POLICY_SUPERSEDED before any bid write', () => {
    const bodyStart = sql70.indexOf('create function public.submit_sandbox_bid(');
    expect(bodyStart).toBeGreaterThan(-1);
    const body = sql70.slice(bodyStart);
    expect(body).toContain('POLICY_SUPERSEDED');
    // Gate block: from the NULL-guard to the phase computation. Anchors are
    // CODE (comment markers are stripped above — never slice on prose).
    const gateStart = body.indexOf('if p_expected_policy_version is not null');
    expect(gateStart).toBeGreaterThan(-1);
    const gateEnd = body.indexOf('v_effective := v_room.status');
    expect(gateEnd).toBeGreaterThan(gateStart);
    const gate = body.slice(gateStart, gateEnd);
    expect(gate).toMatch(/from public\.auction_sandbox_policy_versions/);
    expect(gate).toMatch(/where room_id = p_room_id/);
    expect(gate).toMatch(/and version > p_expected_policy_version\)/);
    // The gate precedes the sequence bump + bid insert (fail before mutate).
    expect(body.indexOf('POLICY_SUPERSEDED')).toBeLessThan(body.indexOf('next_sequence + 1'));
    // NULL skips the gate (human submits are not policy-bound).
    expect(body).toMatch(/p_expected_policy_version is not null/);
  });

  it('replaces the 4-arg signature with grants re-applied on the 5-arg form', () => {
    expect(sql70).toMatch(/drop function if exists public\.submit_sandbox_bid\(uuid, uuid, bigint, text\)/);
    // Exactly ONE submit definition: a re-added ungated 4-arg overload
    // alongside the 5-arg form would silently route 4-arg callers around
    // the POLICY_SUPERSEDED gate.
    expect(sql70.match(/create function public\.submit_sandbox_bid\(/g)?.length ?? 0).toBe(1);
    expect(sql70).toMatch(/security definer/);
    expect(sql70).toMatch(/revoke all on function public\.submit_sandbox_bid\(uuid, uuid, bigint, text, integer\) from public, anon, authenticated;/);
    expect(sql70).toMatch(/grant execute on function public\.submit_sandbox_bid\(uuid, uuid, bigint, text, integer\)[^;]*to service_role/);
    // No anon/public execution on the new form either (case-tolerant).
    expect(sql70).not.toMatch(/grant\s+execute\s+on\s+function\s+public\.submit_sandbox_bid\(uuid, uuid, bigint, text, integer\)[^;]*to\s+anon/i);
    expect(sql70).not.toMatch(/grant\s+execute\s+on\s+function\s+public\.submit_sandbox_bid\(uuid, uuid, bigint, text, integer\)[^;]*to\s+public[,\s;]/i);
    expect(sql70).not.toMatch(/p_client/i);
  });

  it('app callers bind bot/assisted submits, never human submits', () => {
    const ops = read('app/(internal)/licitaciones/auction-lab/actions.ts');
    expect(ops).toMatch(/rpcSubmit\(admin, bundle\.room\.id, bot\.id, pricePyg, bidKey, policy\.version\)/);
    expect(ops).toMatch(/rpcSubmit\(res\.admin, roomId, bot\.id, pricePyg, bidKey, policy\.version\)/);
    // Universal: EVERY rpcSubmit call in operator actions binds a version —
    // an added unversioned call (NULL skips the gate) must fail loudly.
    const calls = ops.split('\n').filter((l) => /(?<!\.)rpcSubmit\(/.test(l) && !l.trim().startsWith('async function rpcSubmit'));
    expect(calls.length).toBeGreaterThan(0);
    for (const line of calls) {
      expect(line).toContain('policy.version');
    }
    const join = read('app/auction-lab/join/[token]/actions.ts');
    expect(join).not.toContain('p_expected_policy_version');
  });
});
