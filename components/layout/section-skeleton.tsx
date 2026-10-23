export function SectionSkeleton() {
  return (
    <div role="status" aria-label="Cargando sección" className="max-w-5xl space-y-5 animate-pulse">
      <div className="h-6 w-48 rounded bg-[var(--hover)]" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-20 rounded-xl bg-[var(--hover)]" />
        ))}
      </div>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
        <div className="h-10 border-b border-[var(--border)] bg-[var(--panel-2)]" />
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="h-10 border-b border-[var(--border)] last:border-0 flex items-center px-4 gap-4"
          >
            <div className="h-3 w-16 rounded bg-[var(--hover)]" />
            <div className="h-3 w-48 rounded bg-[var(--hover)]" />
            <div className="h-3 w-12 rounded bg-[var(--hover)]" />
          </div>
        ))}
      </div>
    </div>
  );
}

