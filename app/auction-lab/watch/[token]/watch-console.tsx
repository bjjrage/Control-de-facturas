'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { WatchView } from '@/lib/auction-sandbox/server';
import { PollController, isNextRedirect, createResponseGuard } from '@/lib/auction-sandbox/poll-controller';
import { formatPctBelowGroundFloor } from '@/lib/auction-sandbox/format';
import { getWatchView } from './actions';

function fmtT(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-PY', { hour12: false });
}

/** Elapsed mm:ss from a server anchor (never remaining time). */
function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function WatchConsole({ token }: { token: string }) {
  const [view, setView] = useState<WatchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadExpired, setLoadExpired] = useState(false);
  // Phase elapsed clock (display only, no controls for observers).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const controllerRef = useRef<PollController | null>(null);
  const guardRef = useRef(createResponseGuard());

  const poll = useCallback(async () => {
    // Epoch guard: a late response must never overwrite fresher state.
    const seq = guardRef.current.begin();
    const alive = () => guardRef.current.isCurrent(seq);
    try {
      const res = await getWatchView(token);
      if (!alive()) return;
      if (res.error) {
        setError(res.error);
        if (/inválido|vencido/i.test(res.error)) controllerRef.current?.stop();
        return;
      }
      if (res.view) {
        setView(res.view);
        setError(null);
        if (res.view.room.status === 'CLOSED') controllerRef.current?.stop();
      }
    } catch (e) {
      if (!alive()) return;
      if (isNextRedirect(e)) {
        controllerRef.current?.stop();
        window.location.reload();
        return;
      }
      setError('Error de conexión. Revisá tu sesión si persiste.');
    }
  }, [token]);
  const pollRef = useRef(poll);
  pollRef.current = poll;

  useEffect(() => {
    const ctl = new PollController(() => pollRef.current(), { intervalMs: 1000 });
    controllerRef.current = ctl;
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

  // A token error with a loaded view means the link died mid-session:
  // replace the stale board instead of a live-looking screen + banner.
  const linkDead = error !== null && /inválido|vencido/i.test(error);
  if (linkDead) {
    return (
      <div className="min-h-screen bg-[var(--background)] px-4 py-8">
        <div className="mx-auto w-full max-w-3xl space-y-4">
          <Image src="/logo/niupack-wordmark.svg" alt="niupack" width={120} height={26} priority />
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-6 text-[13px] space-y-2">
            <p className="font-semibold text-[14px]">Este enlace ya no es válido.</p>
            <p className="text-[var(--muted)]">{error} Pedile al operador el link actual de observer.</p>
          </div>
        </div>
      </div>
    );
  }

  if (error && !view) {
    return (
      <div className="min-h-screen bg-[var(--background)] px-4 py-8">
        <div className="mx-auto w-full max-w-3xl rounded-lg border border-[var(--border)] bg-[var(--panel)] p-6 text-[13px] text-[var(--error)]">
          {error} <button className="underline" onClick={() => window.location.reload()}>Reintentar</button>
        </div>
      </div>
    );
  }
  if (!view) {
    return (
      <div className="min-h-screen bg-[var(--background)] px-4 py-8">
        <div className="mx-auto w-full max-w-3xl text-[13px] text-[var(--muted)]">
          {loadExpired ? (
            <span>La sala tarda demasiado en conectar. <button className="underline" onClick={() => window.location.reload()}>Reintentar</button></span>
          ) : (
            'Conectando a la sala…'
          )}
        </div>
      </div>
    );
  }

  const d = view.lastDecision as { action?: string; candidatePricePyg?: number; reasonDescription?: string; reasonCode?: string; policyVersion?: number } | null;

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-8">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="flex items-center justify-between">
          <Image src="/logo/niupack-wordmark.svg" alt="niupack" width={120} height={26} priority />
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> {view.room.status === 'CLOSED' ? 'SUBASTA CERRADA · SIMULACIÓN' : view.room.status === 'DRAFT' ? 'SIMULACIÓN SIN INICIAR' : 'SUBASTA EN VIVO · SIMULACIÓN'}
          </span>
        </div>

        <div>
          <h1 className="text-[18px] font-bold tracking-tight">{view.room.title}</h1>          <p className="text-[13px] text-[var(--muted)]">
            {view.room.status}
          </p>
          {view.room.status === 'ACTIVE_NORMAL' && view.room.started_at ? (
            <p className="text-[12px] text-[var(--muted)]">
              FASE NORMAL · {fmtElapsed(nowMs - Date.parse(view.room.started_at))} transcurridos
            </p>
          ) : null}
          {view.room.status === 'ACTIVE_RANDOM' && view.room.random_started_at ? (
            <p className="text-[12px] text-[var(--muted)]">
              FASE ALEATORIA · {fmtElapsed(nowMs - Date.parse(view.room.random_started_at))} transcurridos{' '}
              <span className="font-semibold text-amber-600 dark:text-amber-400">CIERRE EN CUALQUIER MOMENTO</span>
            </p>
          ) : null}
        </div>

        {error ? (
          <div className="rounded-xl border border-[var(--error)]/30 bg-[var(--error-bg)] p-3 text-[12px] text-[var(--error)]">
            {error}
          </div>
        ) : null}

        {view.result ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
            <p className="text-[15px] font-bold text-emerald-600 dark:text-emerald-400">
              Ganador: {view.result.winner_alias ?? '—'} · ₲{(view.result.price_pyg ?? 0).toLocaleString('es-PY')}
            </p>
            <p className="text-[12px] text-[var(--muted)]">{view.result.total_bids} lances en total</p>
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
            <h2 className="text-[13px] font-semibold mb-2">Ranking</h2>
            {view.ranking.length === 0 ? (
              <p className="text-[12px] text-[var(--muted)]">Sin ofertas. Apertura: ₲{view.room.opening_price_pyg.toLocaleString('es-PY')}.</p>
            ) : (
              <table>
                <tbody>
                  {view.ranking.map((r) => (
                    <tr key={r.participant_id}>
                      <td className="mono text-[12px] text-[var(--muted)]">#{r.rank}</td>
                      <td className="text-[13px] font-medium">{r.display_alias}</td>
                      <td className="num text-[13px] font-bold">₲ {r.price_pyg.toLocaleString('es-PY')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <h2 className="text-[13px] font-semibold mt-4 mb-2">Últimos lances</h2>
            <ul className="space-y-1 text-[12px]">
              {view.recentBids.slice(0, 6).map((b, i) => (
                <li key={i} className="flex justify-between">
                  <span>{b.display_alias} <strong className="font-mono">₲ {b.price_pyg.toLocaleString('es-PY')}</strong></span>
                  <span className="text-[var(--muted)] mono">{fmtT(b.server_received_at)}</span>
                </li>
              ))}
              {view.recentBids.length === 0 ? <li className="text-[var(--muted)]">—</li> : null}
            </ul>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
              <h2 className="text-[13px] font-semibold mb-2">Bot</h2>
              <div className="inline-flex items-center rounded-md bg-blue-600 px-2.5 py-1 text-[12px] font-bold text-white mb-2">
                {view.botStatus ?? '—'}
              </div>
              {view.pendingCandidate && (view.room.status === 'ACTIVE_NORMAL' || view.room.status === 'ACTIVE_RANDOM') ? (
                <p className="text-[12px] font-semibold text-amber-600 dark:text-amber-400 mb-2">
                  Propone ₲{view.pendingCandidate.pricePyg.toLocaleString('es-PY')} · esperando autorización
                </p>
              ) : null}
              {view.limitBreach ? (
                <div className="rounded-lg border-2 border-amber-500/40 bg-amber-500/10 p-3 text-[12px] space-y-1 mb-2">
                  <p className="font-bold text-amber-600 dark:text-amber-400">Esperando decisión del operador</p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                    <span className="text-[var(--muted)]">Competidor</span>
                    <span className="font-mono font-bold text-right">₲{view.limitBreach.competitorPricePyg.toLocaleString('es-PY')}</span>
                    <span className="text-[var(--muted)]">Ground Floor</span>
                    <span className="font-mono font-bold text-right">₲{view.limitBreach.groundFloorPyg.toLocaleString('es-PY')}</span>
                    <span className="text-[var(--muted)]">Candidate</span>
                    <span className="font-mono font-bold text-right">₲{view.limitBreach.candidatePricePyg.toLocaleString('es-PY')}</span>
                    <span className="text-[var(--muted)]">Debajo del límite</span>
                    <span className="font-mono text-right">{formatPctBelowGroundFloor(view.limitBreach.groundFloorPyg, view.limitBreach.competitorPricePyg)}</span>
                  </div>
                </div>
              ) : null}
              {!view.limitBreach && view.limitBreachDeclined ? (
                <p className="text-[12px] text-[var(--muted)] mb-2">
                  Operador cedió ₲{view.limitBreachDeclined.candidatePricePyg.toLocaleString('es-PY')} — monitoreo continúa.
                </p>
              ) : null}
              {d ? (
                <div className="text-[12px] space-y-0.5">
                  <div><span className="text-[var(--muted)]">Decisión: </span><strong>{d.action}</strong>{typeof d.candidatePricePyg === 'number' ? ` · ₲${d.candidatePricePyg.toLocaleString('es-PY')}` : ''}</div>
                  <div className="text-[var(--muted)]">{d.reasonDescription ?? d.reasonCode ?? ''}</div>
                  <div className="text-[var(--muted)]">Policy v{d.policyVersion ?? '?'}</div>
                </div>
              ) : (
                <p className="text-[12px] text-[var(--muted)]">Sin decisiones todavía.</p>
              )}
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
              <h2 className="text-[13px] font-semibold mb-2">Límites</h2>
              <div className="grid grid-cols-2 gap-1 text-[12px]">
                <span className="text-[var(--muted)]">Target</span>
                <span className="font-mono text-right">{view.policy ? `₲${view.policy.targetPricePyg.toLocaleString('es-PY')}` : '—'}</span>
                <span className="text-[var(--muted)]">Auto Limit</span>
                <span className="font-mono text-right text-rose-600 dark:text-rose-400 font-bold">{view.policy ? `₲${view.policy.autoLimitPyg.toLocaleString('es-PY')}` : '—'}</span>
                <span className="text-[var(--muted)]">Concesión</span>
                <span className="font-mono text-right">{view.kpis.concessionPyg !== null ? `₲${view.kpis.concessionPyg.toLocaleString('es-PY')}` : '—'}</span>
                <span className="text-[var(--muted)]">Distancia al límite</span>
                <span className="font-mono text-right">{view.kpis.distanceToAutoLimitPyg !== null ? `₲${view.kpis.distanceToAutoLimitPyg.toLocaleString('es-PY')}` : '—'}</span>
                <span className="text-[var(--muted)]">Lances bot/humano</span>
                <span className="font-mono text-right">{view.kpis.botBids}/{view.kpis.humanBids}</span>
                <span className="text-[var(--muted)]">Reacción</span>
                <span className="font-mono text-right">{view.kpis.reactionMs !== null ? `${view.kpis.reactionMs} ms` : '—'}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
          <h2 className="text-[13px] font-semibold mb-2">Timeline</h2>
          <div className="space-y-1 max-h-64 overflow-y-auto text-[12px]">
            {[...view.timeline].reverse().map((t, i) => (
              <div key={i} className="flex gap-2">
                <span className="mono text-[var(--muted)] shrink-0">{fmtT(t.at)}</span>
                <span>{t.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
