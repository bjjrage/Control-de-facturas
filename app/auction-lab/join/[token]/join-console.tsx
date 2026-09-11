'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { JoinView } from '@/lib/auction-sandbox/server';
import { getJoinView, submitHumanBid } from './actions';

export function JoinConsole({ token }: { token: string }) {
  const [view, setView] = useState<JoinView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    const res = await getJoinView(token);
    if (res.error) {
      setError(res.error);
      return;
    }
    if (res.view) {
      setView(res.view);
      setError(null);
    }
  }, [token]);

  useEffect(() => {
    void poll();
    timer.current = setInterval(() => void poll(), 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [poll]);

  async function submit() {
    const n = parseInt(price.replace(/\D/g, ''), 10);
    if (!Number.isInteger(n) || n <= 0) {
      setFlash('Ingresá un precio válido en guaraníes.');
      return;
    }
    setBusy(true);
    const key = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    const res = await submitHumanBid(token, n, key);
    setBusy(false);
    if (res.error) {
      setFlash(res.error);
    } else {
      setFlash('Lance enviado.');
      setPrice('');
    }
    setTimeout(() => setFlash(null), 4000);
    await poll();
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
            <Button onClick={submit} disabled={busy} className="w-full">
              {busy ? 'Enviando…' : 'Enviar lance'}
            </Button>
            {flash ? <p className="text-[12px] text-[var(--muted)]">{flash}</p> : null}
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
