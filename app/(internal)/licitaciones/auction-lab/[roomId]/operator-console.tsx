'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { PolicyConfigForm } from '@/components/auction-bot/policy-config-form';
import { FrozenAuctionPolicy } from '@/lib/auction-bot/types';
import { PollController, TimeoutError, isNextRedirect, ReconcilingError, DRAIN_TIMEOUT_MESSAGE, createResponseGuard } from '@/lib/auction-sandbox/poll-controller';
import {
  authorizeAssistedBid,
  authorizeLimitBreachBid,
  authorizeSandboxPolicy,
  declineLimitBreachBid,
  finalizeSandboxRoom,
  getOperatorRoomState,
  pollOperatorRoom,
  regenerateSandboxLinks,
  setSandboxBotPaused,
  startSandboxRoom,
  OperatorView,
} from '../actions';
import { formatPctBelowGroundFloor } from '@/lib/auction-sandbox/format';

function fmtPyg(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `₲${Number(n).toLocaleString('es-PY')}`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('es-PY', { hour12: false });
}

export function OperatorConsole({ roomId, canManage }: { roomId: string; canManage: boolean }) {
  const [view, setView] = useState<OperatorView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [links, setLinks] = useState<{ competitor: string; observer: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showPolicy, setShowPolicy] = useState(false);
  // Transient unequivocal feedback right after a freeze (same pattern as the
  // standalone bot page).
  const [justFrozenVersion, setJustFrozenVersion] = useState<number | null>(null);
  // Transient unequivocal feedback right after an override submit (same
  // pattern as the policy freeze above): the bid is one-shot, the note
  // proves which exact price was authorized.
  const [justOverrodePrice, setJustOverrodePrice] = useState<number | null>(null);
  const [justCeded, setJustCeded] = useState(false);
  // True while a timed-out mutation is still unconfirmed: mutation buttons
  // stay disabled (no blind retry) while reads keep flowing for reconcile.
  const [reconciling, setReconciling] = useState(false);
  // True when the first snapshot never arrived within LOAD_TIMEOUT_MS:
  // the "Cargando…" state must never wedge forever — offer a retry.
  const [loadExpired, setLoadExpired] = useState(false);
  const controllerRef = useRef<PollController | null>(null);
  const guardRef = useRef(createResponseGuard());

  const poll = useCallback(async () => {
    // Epoch guard: a late response must never overwrite fresher state
    // (e.g. an ACTIVE snapshot landing after CLOSED stopped the timer).
    const seq = guardRef.current.begin();
    const alive = () => guardRef.current.isCurrent(seq);
    try {
      // Managers heartbeat (advance + bot tick); comercial gets a read-only view.
      const res = canManage ? await pollOperatorRoom(roomId) : await getOperatorRoomState(roomId);
      if (!alive()) return;
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.view) {
        setView(res.view);
        setError(null);
      }
    } catch (e) {
      if (!alive()) return;
      // Auth expiry arrives as a redirect digest. It must never be swallowed
      // into a frozen view: stop polling and send the user to login. (A
      // rethrow would die inside the controller's guarded tick.)
      if (isNextRedirect(e)) {
        controllerRef.current?.stop();
        window.location.assign('/login');
        return;
      }
      setError('Error de conexión. Revisá tu sesión si persiste.');
    }
  }, [roomId, canManage]);

  const pollRef = useRef(poll);
  pollRef.current = poll;

  useEffect(() => {
    const ctl = new PollController(() => pollRef.current(), { intervalMs: 1000 });
    controllerRef.current = ctl;
    ctl.onOrphanSettled = () => setReconciling(false);
    void ctl.tick();
    ctl.start();
    return () => {
      ctl.stop();
      guardRef.current.reset();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (view) return;
    const t = setTimeout(() => setLoadExpired(true), 30000);
    return () => clearTimeout(t);
  }, [view]);

  const MUTATION_LABELS: Record<string, string> = {
    start: 'Iniciar subasta',
    authz: 'Autorizar lance',
    override: 'Defender posición',
    cede: 'Ceder',
    pause: 'Pausar/reanudar bot',
    finalize: 'Finalizar demo',
    links: 'Regenerar links',
    policy: 'Autorizar policy',
  };

  async function run(key: string, fn: () => Promise<{ error?: string }>, onSuccess?: () => void) {
    const ctl = controllerRef.current;
    const label = MUTATION_LABELS[key] ?? 'Acción';
    if (ctl?.hasUnsettledMutation) {
      setError('Hay una acción anterior sin confirmar. Esperá a que se resuelva antes de reintentar.');
      return;
    }
    setBusy(key);
    setError(null);
    try {
      const out = ctl
        ? await ctl.runMutation(fn, 25000, label)
        : { status: 'done' as const, value: await fn() };
      if (out.status === 'unknown') {
        if (out.detail === DRAIN_TIMEOUT_MESSAGE) {
          // Nothing ran (a stuck read blocked the mutation): safe to retry,
          // so do NOT enter reconciling lock — that path has no orphan and
          // would wedge the buttons with no one to clear them.
          setError(out.detail);
          return;
        }
        // Timeout is NOT a verdict: UI enters reconciling mode (mutations
        // locked, reads flowing) until the orphan settles or the cap hits.
        setReconciling(true);
        setError(
          `Sin confirmación: ${label} tardó demasiado. Mirá el estado actual de la sala: si ya refleja el cambio, no hace falta reintentar.`
        );
        return;
      }
      if (out.value.error) {
        setError(out.value.error);
      } else if (onSuccess) {
        onSuccess();
      }
    } catch (e) {
      // Redirect digests must navigate here (stop+assign like the poll path):
      // rethrowing into a floating onClick promise is an unhandled rejection
      // Next cannot intercept.
      if (isNextRedirect(e)) {
        controllerRef.current?.stop();
        window.location.assign('/login');
        return;
      }
      setError(e instanceof ReconcilingError ? e.message : e instanceof TimeoutError ? e.message : 'Error de conexión.');
    } finally {
      setBusy(null);
    }
  }

  async function copy(text: string, which: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError('No se pudo copiar.');
    }
  }

  async function handleFrozen(frozen: FrozenAuctionPolicy) {
    const ctl = controllerRef.current;
    if (ctl?.hasUnsettledMutation) {
      setError('Hay una acción anterior sin confirmar. Esperá a que se resuelva antes de reintentar.');
      return;
    }
    setBusy('policy');
    setError(null);
    try {
      const out = ctl
        ? await ctl.runMutation(() => authorizeSandboxPolicy(roomId, frozen, frozen.authorizedBy), 25000, 'Autorizar policy')
        : { status: 'done' as const, value: await authorizeSandboxPolicy(roomId, frozen, frozen.authorizedBy) };
      if (out.status === 'unknown') {
        if (out.detail === DRAIN_TIMEOUT_MESSAGE) {
          setError(out.detail);
          return;
        }
        setReconciling(true);
        setError('Sin confirmación: la autorización tardó demasiado. Revisá si aparece la nueva versión antes de reintentar.');
        return;
      }
      if (out.value.error) {
        setError(out.value.error);
        return;
      }
      setShowPolicy(false);
      setJustFrozenVersion(out.value.version ?? null);
    } catch (e) {
      // Same stop+assign rule as run(): never rethrow into a floating promise.
      if (isNextRedirect(e)) {
        controllerRef.current?.stop();
        window.location.assign('/login');
        return;
      }
      setError(e instanceof ReconcilingError ? e.message : e instanceof TimeoutError ? e.message : 'Error de conexión.');
    } finally {
      setBusy(null);
    }
  }

  if (error && !view) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-6 text-[13px] text-[var(--error)]">
        {error}{' '}
        <button className="underline" onClick={() => window.location.reload()}>Reintentar</button>
        {' · '}
        <Link href="/licitaciones/auction-lab" className="underline">Volver a Auction Lab</Link>
      </div>
    );
  }
  if (!view) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-6 text-[13px] text-[var(--muted)]">
        {loadExpired ? (
          <span>La sala tarda demasiado en cargar. <button className="underline" onClick={() => window.location.reload()}>Reintentar</button></span>
        ) : (
          'Cargando sala…'
        )}
      </div>
    );
  }

  const { room, ranking, bot } = view;
  const lb = view.limitBreach;
  // Principal presentation: while the ONLY reason the bot holds fire is the
  // crossed Ground Floor, the operative state is AWAITING_AUTHORIZATION;
  // after CEDER on a still-active room the bot keeps monitoring (MONITORING),
  // so a stale backend STOP must not paint the board as halted. STOP stays
  // reserved for terminal/fail-closed states.
  const roomActive = room.status === 'ACTIVE_NORMAL' || room.status === 'ACTIVE_RANDOM';
  const displayStatus = lb
    ? 'AWAITING_AUTHORIZATION'
    : view.limitBreachDeclined && roomActive
      ? 'MONITORING'
      : bot.status;
  const targetRank = view.activePolicy?.targetRank ?? 1;

  async function handleOverride(p: { candidatePricePyg: number; policyVersion: number }) {
    let price: number | undefined;
    await run(
      'override',
      () =>
        authorizeLimitBreachBid(roomId, p.candidatePricePyg, p.policyVersion).then((r) => {
          price = r.price;
          return { error: r.error };
        }),
      () => {
        if (price !== undefined) setJustOverrodePrice(price);
      }
    );
  }

  async function handleCede(p: { candidatePricePyg: number; policyVersion: number }) {
    await run(
      'cede',
      () => declineLimitBreachBid(roomId, p.candidatePricePyg, p.policyVersion),
      () => setJustCeded(true)
    );
  }
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 mt-1">
        <div>
          <div className="flex items-center gap-2">
            <Link href="/licitaciones/auction-lab" className="text-[12px] text-[var(--muted)] hover:text-[var(--foreground)]">← Auction Lab</Link>
          </div>
          <h1 className="text-[17px] font-semibold">Auction Lab · {room.title}</h1>
          <p className="text-[13px] text-[var(--muted)] mt-0.5">
            <span className="font-mono text-[12px]">{room.group_id}</span> · {room.scope} · {room.status}
            {room.closeRisk ? <span className="ml-2 font-semibold text-rose-600 dark:text-rose-400">CLOSE RISK</span> : null}
            {room.bot_paused ? <span className="ml-2 text-amber-600 dark:text-amber-400">BOT PAUSADO</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!canManage ? (
            <span className="text-[11px] text-[var(--muted)] self-center">Vista de sólo lectura (rol comercial).</span>
          ) : (
            <>
          {room.status === 'DRAFT' ? (
            <Button className="h-8 text-xs" disabled={busy !== null || reconciling} onClick={() => run('start', () => startSandboxRoom(roomId))}>
              {busy === 'start' ? 'Iniciando…' : 'Iniciar subasta'}
            </Button>
          ) : null}
          {room.status !== 'CLOSED' && room.status !== 'DRAFT' ? (
            <Button variant="secondary" className="h-8 text-xs" disabled={busy !== null || reconciling} onClick={() => run('pause', () => setSandboxBotPaused(roomId, !view.botPaused))}>
              {view.botPaused ? 'Reanudar bot' : 'Pausar bot'}
            </Button>
          ) : null}
          {room.status !== 'CLOSED' && room.status !== 'DRAFT' ? (
            <Button variant="secondary" className="h-8 text-xs" disabled={busy !== null || reconciling} onClick={() => run('finalize', () => finalizeSandboxRoom(roomId))}>
              Finalizar demo
            </Button>
          ) : null}
          {room.status !== 'CLOSED' ? (
          <Button
            variant="secondary"
            className="h-8 text-xs"
            disabled={busy !== null || reconciling}
            onClick={() =>
              run('links', async () => {
                const res = await regenerateSandboxLinks(roomId);
                if (!res.error && res.competitorToken && res.observerToken) {
                  setLinks({
                    competitor: `${origin}/auction-lab/join/${res.competitorToken}`,
                    observer: `${origin}/auction-lab/watch/${res.observerToken}`,
                  });
                }
                return res;
              })
            }
          >
            Regenerar links
          </Button>
          ) : null}
          {room.status !== 'CLOSED' ? (
          <Button variant="secondary" className="h-8 text-xs" disabled={busy !== null || reconciling} onClick={() => setShowPolicy((s) => !s)}>
            {showPolicy ? 'Ocultar policy' : 'Cambiar policy'}
          </Button>
          ) : null}
            </>
          )}
        </div>
      </div>

      {error ? <p className="text-[12px] text-[var(--error)]">{error}</p> : null}

      {reconciling && room.status !== 'CLOSED' ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-[12px] font-medium text-amber-600 dark:text-amber-400">
          Acción sin confirmar — reconciliando con el servidor. Las acciones están pausadas hasta confirmar el resultado; no hace falta reintentar.
        </div>
      ) : null}

      {justFrozenVersion !== null && bot.policyVersion === justFrozenVersion && room.status !== 'CLOSED' ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 flex items-center gap-2.5">
          <div className="text-[13px]">
            <span className="font-semibold text-[var(--foreground)]">
              Política v{justFrozenVersion} autorizada
            </span>
            <span className="text-[var(--muted)]"> — el bot ya opera con esta versión.</span>
          </div>
          <button
            onClick={() => setJustFrozenVersion(null)}
            className="ml-auto text-[11px] text-[var(--muted)] hover:text-[var(--foreground)] cursor-pointer shrink-0"
          >
            Cerrar
          </button>
        </div>
      ) : null}

      {links ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2 text-[13px]">
          <p className="font-semibold text-emerald-600 dark:text-emerald-400">Links nuevos — se muestran una sola vez.</p>
          <p className="text-[11px] text-[var(--muted)]">Copiá ambos links antes de salir o recargar: si perdés uno vas a tener que regenerar (y el otro se invalida).</p>
          {([['competidor', links.competitor], ['observer', links.observer]] as const).map(([which, url]) => (
            <div key={which} className="flex items-center gap-2">
              <span className="text-[11px] uppercase text-[var(--muted)] w-24 shrink-0">{which}</span>
              <code className="flex-1 min-w-0 truncate rounded bg-black/5 dark:bg-white/5 px-2 py-1 font-mono text-[11px]">{url}</code>
              <Button variant="secondary" className="h-7 text-[11px]" onClick={() => copy(url, which)}>
                {copied === which ? 'Copiado ✓' : 'Copiar'}
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
          <h2 className="text-[13px] font-semibold mb-2">Ranking</h2>
          {ranking.length === 0 ? (
            <p className="text-[12px] text-[var(--muted)]">Sin ofertas todavía. Apertura: {fmtPyg(room.opening_price_pyg)}.</p>
          ) : (
            <table>
              <tbody>
                {ranking.map((r) => (
                  <tr key={r.participant_id}>
                    <td className="mono text-[12px] text-[var(--muted)]">#{r.rank}</td>
                    <td className="text-[13px]">{r.display_alias}</td>
                    <td className="num text-[13px] font-medium">₲ {r.price_pyg.toLocaleString('es-PY')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 space-y-2 text-[13px]">
          <h2 className="text-[13px] font-semibold">Bot</h2>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
            <span className="text-[var(--muted)]">Policy</span>
            <span className="font-medium">{bot.policyVersion !== null ? `v${bot.policyVersion}` : 'Sin autorizar'}</span>
            <span className="text-[var(--muted)]">Modo</span>
            <span className="font-medium">{bot.mode ?? '—'}</span>
            <span className="text-[var(--muted)]">Target</span>
            <span className="font-medium">{fmtPyg(bot.targetPricePyg)}</span>
            <span className="text-[var(--muted)]">Auto Limit</span>
            <span className="font-medium text-rose-600 dark:text-rose-400">{fmtPyg(bot.autoLimitPyg)}</span>
            <span className="text-[var(--muted)]">Estado</span>
            <span className="font-semibold">{displayStatus ?? '—'}</span>
          </div>
          {lb ? (
            <div className="rounded-lg border-2 border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
              <p className="text-[12px] font-bold text-amber-600 dark:text-amber-400">⚠ LÍMITE AUTOMÁTICO SUPERADO</p>
              <p className="text-[12px]">
                El competidor está {formatPctBelowGroundFloor(lb.groundFloorPyg, lb.competitorPricePyg)} por debajo de tu Ground Floor.
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
                <span className="text-[var(--muted)]">Competidor</span>
                <span className="font-mono font-bold text-right">{fmtPyg(lb.competitorPricePyg)}</span>
                <span className="text-[var(--muted)]">Ground Floor</span>
                <span className="font-mono font-bold text-right">{fmtPyg(lb.groundFloorPyg)}</span>
                <span className="text-[var(--muted)]">Próximo lance</span>
                <span className="font-mono font-bold text-right">{fmtPyg(lb.candidatePricePyg)}</span>
                <span className="text-[var(--muted)]">Paso de defensa</span>
                <span className="font-mono text-right">{fmtPyg(lb.defenseStepPyg)}</span>
              </div>
              <p className="text-[12px] text-[var(--muted)]">
                Para mantener la posición #{targetRank} el bot necesita tu autorización.
              </p>
              {canManage ? (
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    className="h-8 text-xs"
                    disabled={busy !== null || reconciling}
                    onClick={() => handleCede(lb)}
                  >
                    {busy === 'cede' ? 'Cediendo…' : 'CEDER'}
                  </Button>
                  <Button
                    className="h-8 text-xs flex-1"
                    disabled={busy !== null || reconciling}
                    onClick={() => handleOverride(lb)}
                  >
                    {busy === 'override' ? 'Defendiendo…' : `DEFENDER POSICIÓN · ${fmtPyg(lb.candidatePricePyg)}`}
                  </Button>
                </div>
              ) : (
                <p className="text-[11px] text-[var(--muted)]">Solo un administrador puede decidir.</p>
              )}
            </div>
          ) : null}
          {!lb && view.limitBreachDeclined ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3 text-[12px] text-[var(--muted)]">
              Cediste {fmtPyg(view.limitBreachDeclined.candidatePricePyg)} (v{view.limitBreachDeclined.policyVersion}). El bot sigue monitoreando.
            </div>
          ) : null}
          {justOverrodePrice !== null && !lb ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-[12px] flex items-center gap-2">
              <span>Lance {fmtPyg(justOverrodePrice)} enviado por override humano (one-shot).</span>
              <button
                onClick={() => setJustOverrodePrice(null)}
                className="ml-auto text-[11px] text-[var(--muted)] hover:text-[var(--foreground)] cursor-pointer shrink-0"
              >
                Cerrar
              </button>
            </div>
          ) : null}
          {justCeded && !lb && !view.limitBreachDeclined ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3 text-[12px] text-[var(--muted)]">
              Cedido registrado.
            </div>
          ) : null}
          {bot.lastDecision ? (
            <div className="rounded border border-[var(--border)] bg-[var(--panel-2)] p-2.5 text-[12px] space-y-0.5">
              <div><span className="text-[var(--muted)]">Última decisión: </span><strong>{String(bot.lastDecision.action ?? '?')}</strong></div>
              {typeof bot.lastDecision.candidatePricePyg === 'number' ? (
                <div><span className="text-[var(--muted)]">Candidate: </span><strong>₲ {Number(bot.lastDecision.candidatePricePyg).toLocaleString('es-PY')}</strong></div>
              ) : null}
              <div className="text-[var(--muted)]">{String(bot.lastDecision.reasonDescription ?? bot.lastDecision.reasonCode ?? '')}</div>
            </div>
          ) : null}
          {bot.pendingCandidate && (room.status === 'ACTIVE_NORMAL' || room.status === 'ACTIVE_RANDOM') ? (
            <div className="rounded-lg border-2 border-amber-500/40 bg-amber-500/10 p-3">
              <p className="text-[12px] font-semibold text-amber-600 dark:text-amber-400">
                BOT PROPONE ₲ {Number(bot.pendingCandidate.pricePyg).toLocaleString('es-PY')}
              </p>
              {canManage ? (
                <Button
                  className="h-8 text-xs mt-2"
                  disabled={busy !== null || reconciling}
                  onClick={() => run('authz', () => authorizeAssistedBid(roomId).then((r) => ({ error: r.error })))}
                >
                  {busy === 'authz' ? 'Autorizando…' : 'Autorizar lance'}
                </Button>
              ) : (
                <p className="text-[11px] text-[var(--muted)] mt-1">Solo un administrador puede autorizar el lance.</p>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {view.watch.result ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-[13px]">
          <p className="font-semibold text-emerald-600 dark:text-emerald-400">
            Ganador: {view.watch.result.winner_alias ?? '—'} · ₲ {(view.watch.result.price_pyg ?? 0).toLocaleString('es-PY')}
          </p>
          <p className="text-[var(--muted)] text-[12px]">
            {view.watch.result.total_bids} lances · Bot: {view.watch.kpis.botBids} · Humano: {view.watch.kpis.humanBids} ·
            Auto Limit {bot.autoLimitPyg !== null ? (view.watch.kpis.distanceToAutoLimitPyg !== null && view.watch.kpis.distanceToAutoLimitPyg >= 0 ? 'respetado' : 'revisar') : '—'}
          </p>
          <Link href="/licitaciones/auction-lab" className="inline-flex items-center h-8 rounded-md bg-blue-600 px-3 text-[13px] font-medium text-white mt-2">
            Nueva simulación
          </Link>
        </div>
      ) : null}

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
        <h2 className="text-[13px] font-semibold mb-2">Timeline</h2>
        <div className="space-y-1 max-h-64 overflow-y-auto text-[12px]">
          {view.watch.timeline.length === 0 ? <p className="text-[var(--muted)]">Sin eventos.</p> : null}
          {[...view.watch.timeline].reverse().map((t, i) => (
            <div key={i} className="flex gap-2">
              <span className="mono text-[var(--muted)] shrink-0">{fmtTime(t.at)}</span>
              <span>{t.text}</span>
            </div>
          ))}
        </div>
      </div>

      {showPolicy && canManage && room.status !== 'CLOSED' ? (
        <div className="space-y-2">
          <h2 className="text-[13px] font-semibold">Autorizar policy {bot.policyVersion !== null ? `v${bot.policyVersion + 1}` : 'v1'}</h2>
          <PolicyConfigForm
            initialPolicy={view.activePolicy ?? undefined}
            activeFrozenPolicy={view.activePolicy}
            onPolicyFrozen={(frozen) => void handleFrozen(frozen)}
          />
        </div>
      ) : null}
    </div>
  );
}
