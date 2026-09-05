export default function ProjectLoading() {
  return (
    <div className="max-w-5xl space-y-5 animate-pulse">
      <div className="h-6 w-36 rounded bg-[var(--hover)]" />

      <div className="flex items-start justify-between mt-1">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-5 w-48 rounded bg-[var(--hover)]" />
            <div className="h-4 w-16 rounded bg-[var(--hover)]" />
          </div>
          <div className="h-3.5 w-40 rounded bg-[var(--hover)]" />
        </div>
        <div className="flex gap-1">
          <div className="h-8 w-8 rounded bg-[var(--hover)]" />
          <div className="h-8 w-8 rounded bg-[var(--hover)]" />
          <div className="h-8 w-28 rounded bg-[var(--hover)]" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3.5 space-y-2">
            <div className="h-2.5 w-24 rounded bg-[var(--hover)]" />
            <div className="h-5 w-32 rounded bg-[var(--hover)]" />
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="h-8 w-28 rounded bg-[var(--hover)]" />
          <div className="h-8 w-24 rounded bg-[var(--hover)]" />
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
          <div className="h-10 border-b border-[var(--border)] bg-[var(--panel-2)]" />
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-10 border-b border-[var(--border)] last:border-0 flex items-center px-4 gap-4">
              <div className="h-3 w-16 rounded bg-[var(--hover)]" />
              <div className="h-3 w-48 rounded bg-[var(--hover)]" />
              <div className="h-3 w-12 rounded bg-[var(--hover)]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
