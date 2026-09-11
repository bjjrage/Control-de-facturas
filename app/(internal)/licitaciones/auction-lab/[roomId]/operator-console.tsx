'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { PolicyConfigForm } from '@/components/auction-bot/policy-config-form';
import { FrozenAuctionPolicy } from '@/lib/auction-bot/types';
import { PollController, TimeoutError } from '@/lib/auction-sandbox/poll-controller';
import {
  authorizeAssistedBid,
  authorizeSandboxPolicy,
  finalizeSandboxRoom,
  getOperatorRoomState,
  pollOperatorRoom,
  regenerateSandboxLinks,
  setSandboxBotPaused,
  startSandboxRoom,
  OperatorView,
} from '../actions';

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
  const controllerRef = useRef<PollController | null>(null);

  const poll = useCallback(async () => {
    // Managers heartbeat (advance + bot tick); comercial gets a read-only view.
    const res = canManage ? await pollOperatorRoom(roomId) : await getOperatorRoomState(roomId);
    if (res.error) {
      setError(res.error);
      return;
    }
    if (res.view) {
      setView(res.view);
      setError(null);
    }
  }, [roomId, canManage]);

  const pollRef = useRef(poll);
  pollRef.current = poll;

  useEffect(() => {
    const ctl = new PollController(() => pollRef.current(), { intervalMs: 1000 });
    controllerRef.current = ctl;
    void ctl.tick();
    ctl.start();
    return () => {
      ctl.stop();
      controllerRef.current = null;
    };
  }, []);

  const MUTATION_LABELS: Record<string, string> = {
    start: 'Iniciar subasta',
    authz: 'Autorizar lance',
    pause: 'Pausar/reanudar bot',
    finalize: 'Finalizar demo',
    links: 'Regenerar links',
    policy: 'Autorizar policy',
  };

  async function run(key: string, fn: () => Promise<{ error?: string }>) {
    const ctl = controllerRef.current;
    setBusy(key);
    setError(null);
    try {
      const res = ctl
        ? await ctl.runMutation(fn, 25000, MUTATION_LABELS[key] ?? 'Acción')
        : await fn();
      if (res.error) setError(res.error);
    } catch (e) {
      setError(e instanceof TimeoutError ? e.message : 'Error de conexión.');
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
    setBusy('policy');
    setError(null);
    try {
      const res = ctl
        ? await ctl.runMutation(() => authorizeSandboxPolicy(roomId, frozen, frozen.authorizedBy), 25000, 'Autorizar policy')
        : await authorizeSandboxPolicy(roomId, frozen, frozen.authorizedBy);
      if (res.error) {
        setError(res.error);
        return;
      }
      setShowPolicy(false);
      setJustFrozenVersion(res.version ?? null);
    } catch (e) {
      setError(e instanceof TimeoutError ? e.message : 'Error de conexión.');
    } finally {
      setBusy(null);
    }
  }

  if (error && !view) {
    return <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-6 text-[13px] text-[var(--error)]">{error}</div>;
  }
  if (!view) {
    return <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-6 text-[13px] text-[var(--muted)]">Cargando sala…</div>;
  }

  const { room, ranking, bot } = view;
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
            <Button className="h-8 text-xs" disabled={busy !== null} onClick={() => run('start', () => startSandboxRoom(roomId))}>
              {busy === 'start' ? 'Iniciando…' : 'Iniciar subasta'}
            </Button>
          ) : null}
          {room.status !== 'CLOSED' && room.status !== 'DRAFT' ? (
            <Button variant="secondary" className="h-8 text-xs" disabled={busy !== null} onClick={() => run('pause', () => setSandboxBotPaused(roomId, !view.botPaused))}>
              {view.botPaused ? 'Reanudar bot' : 'Pausar bot'}
            </Button>
          ) : null}
          {room.status !== 'CLOSED' && room.status !== 'DRAFT' ? (
            <Button variant="secondary" className="h-8 text-xs" disabled={busy !== null} onClick={() => run('finalize', () => finalizeSandboxRoom(roomId))}>
              Finalizar demo
            </Button>
          ) : null}
          <Button
            variant="secondary"
            className="h-8 text-xs"
            disabled={busy !== null}
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
          <Button variant="secondary" className="h-8 text-xs" onClick={() => setShowPolicy((s) => !s)}>
            {showPolicy ? 'Ocultar policy' : 'Cambiar policy'}
          </Button>
            </>
          )}
        </div>
      </div>

      {error ? <p className="text-[12px] text-[var(--error)]">{error}</p> : null}

      {justFrozenVersion !== null && bot.policyVersion === justFrozenVersion ? (
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
            <span className="font-semibold">{bot.status ?? '—'}</span>
          </div>
          {bot.lastDecision ? (
            <div className="rounded border border-[var(--border)] bg-[var(--panel-2)] p-2.5 text-[12px] space-y-0.5">
              <div><span className="text-[var(--muted)]">Última decisión: </span><strong>{String(bot.lastDecision.action ?? '?')}</strong></div>
              {typeof bot.lastDecision.candidatePricePyg === 'number' ? (
                <div><span className="text-[var(--muted)]">Candidate: </span><strong>₲ {Number(bot.lastDecision.candidatePricePyg).toLocaleString('es-PY')}</strong></div>
              ) : null}
              <div className="text-[var(--muted)]">{String(bot.lastDecision.reasonDescription ?? bot.lastDecision.reasonCode ?? '')}</div>
            </div>
          ) : null}
          {bot.pendingCandidate && room.status !== 'CLOSED' ? (
            <div className="rounded-lg border-2 border-amber-500/40 bg-amber-500/10 p-3">
              <p className="text-[12px] font-semibold text-amber-600 dark:text-amber-400">
                BOT PROPONE ₲ {Number(bot.pendingCandidate.pricePyg).toLocaleString('es-PY')}
              </p>
              {canManage ? (
                <Button
                  className="h-8 text-xs mt-2"
                  disabled={busy !== null}
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

      {showPolicy && canManage ? (
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
