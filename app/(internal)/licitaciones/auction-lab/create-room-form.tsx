'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { createSandboxRoom } from './actions';

const QUICK_DEMO = {
  title: 'TEST-001',
  scope: 'ITEM' as const,
  group_id: 'item-1',
  opening_price_pyg: 1_050_000,
  normal_duration_seconds: 60,
  random_min_seconds: 30,
  random_max_seconds: 90,
  minimum_decrement_pyg: 1,
};

function num(v: string, fallback: number): number {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function CreateRoomForm() {
  const router = useRouter();
  const [form, setForm] = useState({ ...QUICK_DEMO, title: '', group_id: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ roomId: string; competitorToken: string; observerToken: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await createSandboxRoom({
      title: form.title.trim(),
      scope: form.scope,
      group_id: form.group_id.trim(),
      opening_price_pyg: form.opening_price_pyg,
      normal_duration_seconds: form.normal_duration_seconds,
      random_min_seconds: form.random_min_seconds,
      random_max_seconds: form.random_max_seconds,
      minimum_decrement_pyg: form.minimum_decrement_pyg,
    });
    setBusy(false);
    if (res.error || !res.roomId || !res.competitorToken || !res.observerToken) {
      setError(res.error ?? 'No se pudo crear la sala.');
      return;
    }
    setCreated({ roomId: res.roomId, competitorToken: res.competitorToken, observerToken: res.observerToken });
    router.refresh();
  }

  async function copy(text: string, which: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError('No se pudo copiar al portapapeles.');
    }
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[14px] font-semibold">Nueva subasta de prueba</h2>
        <Button variant="secondary" className="h-8 text-xs" onClick={() => setForm({ ...QUICK_DEMO })}>
          Demo rápida
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2">
          <Label htmlFor="lab-title">Nombre *</Label>
          <Input id="lab-title" value={form.title} onChange={(e) => set('title', (e.target as HTMLInputElement).value)} placeholder="TEST-001" />
        </div>
        <div>
          <Label htmlFor="lab-scope">Scope *</Label>
          <select
            id="lab-scope"
            value={form.scope}
            onChange={(e) => set('scope', (e.target as HTMLSelectElement).value as typeof form.scope)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-3 py-1.5 text-[13px] outline-none"
          >
            <option value="ITEM">ITEM</option>
            <option value="LOT">LOT</option>
            <option value="TOTAL">TOTAL</option>
          </select>
        </div>
        <div>
          <Label htmlFor="lab-group">Group ID *</Label>
          <Input id="lab-group" value={form.group_id} onChange={(e) => set('group_id', (e.target as HTMLInputElement).value)} placeholder="item-1" />
        </div>
        <div>
          <Label htmlFor="lab-opening">Precio inicial PYG *</Label>
          <Input id="lab-opening" type="number" min={1} value={form.opening_price_pyg} onChange={(e) => set('opening_price_pyg', num((e.target as HTMLInputElement).value, 1))} />
        </div>
        <div>
          <Label htmlFor="lab-normal">Fase normal (seg) *</Label>
          <Input id="lab-normal" type="number" min={5} value={form.normal_duration_seconds} onChange={(e) => set('normal_duration_seconds', num((e.target as HTMLInputElement).value, 60))} />
        </div>
        <div>
          <Label htmlFor="lab-rmin">Random mín (seg) *</Label>
          <Input id="lab-rmin" type="number" min={0} value={form.random_min_seconds} onChange={(e) => set('random_min_seconds', num((e.target as HTMLInputElement).value, 30))} />
        </div>
        <div>
          <Label htmlFor="lab-rmax">Random máx (seg) *</Label>
          <Input id="lab-rmax" type="number" min={0} value={form.random_max_seconds} onChange={(e) => set('random_max_seconds', num((e.target as HTMLInputElement).value, 90))} />
        </div>
        <div>
          <Label htmlFor="lab-mindec">Decremento mínimo PYG *</Label>
          <Input id="lab-mindec" type="number" min={1} value={form.minimum_decrement_pyg} onChange={(e) => set('minimum_decrement_pyg', num((e.target as HTMLInputElement).value, 1))} />
        </div>
      </div>

      {error ? <p className="text-[12px] text-[var(--error)]">{error}</p> : null}

      <div>
        <Button onClick={submit} disabled={busy}>
          {busy ? 'Creando…' : 'Crear subasta de prueba'}
        </Button>
      </div>

      {created ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2 text-[13px]">
          <p className="font-semibold text-emerald-600 dark:text-emerald-400">Sala creada. Guardá estos links — se muestran una sola vez.</p>
          {(
            [
              ['competidor', `${origin}/auction-lab/join/${created.competitorToken}`],
              ['observer', `${origin}/auction-lab/watch/${created.observerToken}`],
            ] as const
          ).map(([which, url]) => (
            <div key={which} className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wide text-[var(--muted)] w-24 shrink-0">{which}</span>
              <code className="flex-1 min-w-0 truncate rounded bg-black/5 dark:bg-white/5 px-2 py-1 font-mono text-[11px]">{url}</code>
              <Button variant="secondary" className="h-7 text-[11px]" onClick={() => copy(url, which)}>
                {copied === which ? 'Copiado ✓' : 'Copiar'}
              </Button>
            </div>
          ))}
          <div className="pt-1">
            <Link href={`/licitaciones/auction-lab/${created.roomId}`} className="inline-flex items-center h-8 rounded-md bg-blue-600 px-3 text-[13px] font-medium text-white">
              Abrir sala
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
