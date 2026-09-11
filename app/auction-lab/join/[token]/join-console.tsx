'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { JoinView } from '@/lib/auction-sandbox/server';
import { PollController, TimeoutError, isNextRedirect, ReconcilingError } from '@/lib/auction-sandbox/poll-controller';
import { getJoinView, submitHumanBid } from './actions';

export function JoinConsole({ token }: { token: string }) {
  const [view, setView] = useState<JoinView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [flashKind, setFlashKind] = useState<'ok' | 'error'>('ok');
  const [reconciling, setReconciling] = useState(false);
  const controllerRef = useRef<PollController | null>(null);

  const say = (text: string, kind: 'ok' | 'error' = 'ok') => {
    setFlash(text);
    setFlashKind(kind);
  };

  const poll = useCallback(async () => {
    try {
      const res = await getJoinView(token);
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.view) {
        setView(res.view);
        setError(null);
        if (res.view.room.status === 'CLOSED') controllerRef.current?.stop();
      }
    } catch (e) {
      if (isNextRedirect(e)) throw e;
      setError('Error de conexión. Revisá tu sesión si persiste.');
    }
  }, [token]);
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
      controllerRef.current = null;
    };
  }, []);

  async function submit() {
    const n = parseInt(price.replace(/\D/g, ''), 10);
    if (!Number.isInteger(n) || n <= 0) {
      say('Ingresá un precio válido en guaraníes.', 'error');
      return;
    }
    const ctl = controllerRef.current;
    if (ctl?.hasUnsettledMutation) {
      say('Hay un envío anterior sin confirmar. Esperá a que se resuelva antes de reintentar.', 'error');
      return;
    }
    setBusy(true);
    try {
      const key = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      // Submit with polling suspended (single authoritative refresh after);
      // a hung submit settles as unknown instead of wedging the button.
      const out = ctl
        ? await ctl.runMutation(() => submitHumanBid(token, n, key), 25000, 'Enviar lance')
        : { status: 'done' as const, value: await submitHumanBid(token, n, key) };
      if (out.status === 'unknown') {
        setReconciling(true);
        say(out.detail ?? 'Sin confirmación: revisá tus lances, el envío puede haber llegado. No reenvíes a ciegas.', 'error');
      } else if (out.value.error) {
        say(out.value.error, 'error');
      } else {
        say('Lance enviado.', 'ok');
        setPrice('');
      }
    } catch (e) {
      if (isNextRedirect(e)) throw e;
      say(e instanceof ReconcilingError ? e.message : e instanceof TimeoutError ? e.message : 'Error de conexión.', 'error');
    } finally {
      setBusy(false);
    }
    setTimeout(() => setFlash(null), 4000);
  }

  if (error && !view) {
    return (
      <div className="min-h-screen bg-[var(--background)] px-4 py-8">
        <div className="mx-auto w-full max-w-lg rounded-lg border border-[var(--border)] bg-[var(--panel)] p-6 text-[13px] text-[var(--error)]">{error}</div>
      </div>
    );
  }
  if (!view) {
    return (
      <div className="min-h-screen bg-[var(--background)] px-4 py-8">
        <div className="mx-auto w-full max-w-lg text-[13px] text-[var(--muted)]">Cargando subasta…</div>
      </div>
    );
  }

  const closed = view.room.status === 'CLOSED';
  const iWon = closed && view.myRank === 1;

  return (
    <div className="min-h-screen bg-[var(--background)] px-4 py-8">
      <div className="mx-auto w-full max-w-lg space-y-4">
        <div>
          <Image src="/logo/niupack-wordmark.svg" alt="niupack" width={120} height={26} priority />
        </div>

        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-[12px] font-semibold text-amber-600 dark:text-amber-400">
          SIMULACIÓN — NO ES DNCP REAL
        </div>

        {error ? (
          <div className="rounded-lg border border-[var(--error)]/30 bg-[var(--error-bg)] p-3 text-[12px] text-[var(--error)]">
            {error}
          </div>
        ) : null}

        {reconciling ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-[12px] font-medium text-amber-600 dark:text-amber-400">
            Envío sin confirmar — reconciliando con el servidor. No reenvíes hasta que se resuelva.
          </div>
        ) : null}

        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
          <p className="text-[11px] text-[var(--muted)]">Subasta simulada</p>
          <h1 className="text-[16px] font-semibold">{view.room.title}</h1>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[13px]">
            <div><span className="text-[var(--muted)]">Fase: </span><strong>{view.room.status}{view.room.closeRisk ? ' · RIESGO DE CIERRE' : ''}</strong></div>
            <div><span className="text-[var(--muted)]">Tu posición: </span><strong>{view.myRank !== null ? `#${view.myRank}` : '—'}</strong></div>
            <div><span className="text-[var(--muted)]">Mejor oferta: </span><strong>{view.bestPrice !== null ? `₲${view.bestPrice.toLocaleString('es-PY')}` : '—'}</strong></div>
            <div><span className="text-[var(--muted)]">Tu oferta: </span><strong>{view.myPrice !== null ? `₲${view.myPrice.toLocaleString('es-PY')}` : '—'}</strong></div>
          </div>
        </div>

        {closed ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5 text-[14px]">
            {iWon ? <p className="font-semibold text-emerald-600 dark:text-emerald-400">¡Ganaste la simulación! 🎉</p> : <p className="font-semibold">Subasta cerrada.</p>}
            {view.bestPrice !== null ? <p className="text-[var(--muted)] text-[13px]">Precio final: ₲{view.bestPrice.toLocaleString('es-PY')}</p> : null}
          </div>
        ) : view.room.status === 'DRAFT' ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5 text-[13px] text-[var(--muted)]">
            La subasta todavía no inició. Esperá a que el operador la abra — esta pantalla se actualiza sola.
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5 space-y-3">
            <div>
              <Label htmlFor="join-price">Nueva oferta (PYG)</Label>
              <Input
                id="join-price"
                inputMode="numeric"
                value={price}
                onChange={(e) => setPrice((e.target as HTMLInputElement).value)}
                placeholder="Ej: 999999"
              />
              <p className="text-[11px] text-[var(--muted)] mt-1">
                Debe ser menor a tu última oferta y mejorar al mejor precio en al menos ₲{view.room.minimum_decrement_pyg.toLocaleString('es-PY')}.
              </p>
            </div>
            <Button onClick={submit} disabled={busy || reconciling} className="w-full">
              {busy ? 'Enviando…' : reconciling ? 'Confirmando envío…' : 'Enviar lance'}
            </Button>
            {flash ? (
              <p className={`text-[12px] ${flashKind === 'error' ? 'text-[var(--error)] font-medium' : 'text-[var(--muted)]'}`}>{flash}</p>
            ) : null}
          </div>
        )}

        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
          <h2 className="text-[13px] font-semibold mb-2">Tus últimos lances</h2>
          {view.myBids.length === 0 ? (
            <p className="text-[12px] text-[var(--muted)]">Todavía no ofertaste.</p>
          ) : (
            <ul className="space-y-1 text-[12px]">
              {view.myBids.slice(0, 10).map((b, i) => (
                <li key={i} className="flex justify-between">
                  <span className="font-mono">₲ {b.price_pyg.toLocaleString('es-PY')}</span>
                  <span className="text-[var(--muted)]">{new Date(b.server_received_at).toLocaleTimeString('es-PY', { hour12: false })}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
