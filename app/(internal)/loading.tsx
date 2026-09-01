// Skeleton mientras el server component de cada sección hace sus queries.
// Hace que la navegación se sienta instantánea en vez de bloquear en blanco.
export default function Loading() {
  return (
    <div className="max-w-5xl animate-pulse space-y-4" aria-hidden>
      <div className="h-5 w-40 rounded bg-[var(--hover)]" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[76px] rounded-xl border border-[var(--border)] bg-[var(--panel)]" />
        ))}
      </div>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
        <div className="h-9 border-b border-[var(--border)] bg-[var(--hover)]/40" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-11 border-b border-[var(--border)] last:border-0" />
        ))}
      </div>
    </div>
  );
}
