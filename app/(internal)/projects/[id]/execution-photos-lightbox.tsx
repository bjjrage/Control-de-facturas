"use client";

import { useState } from "react";

export function ExecutionPhotosLightbox({ urls }: { urls: string[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  if (urls.length === 0) return <span className="text-[var(--muted)]">—</span>;

  return (
    <>
      <div className="flex gap-1">
        {urls.map((u, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            src={u}
            alt=""
            onClick={() => setOpenIdx(i)}
            className="h-8 w-8 object-cover rounded cursor-pointer border border-[var(--border)] hover:opacity-80"
          />
        ))}
      </div>
      {openIdx !== null ? (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center"
          onClick={() => setOpenIdx(null)}
        >
          {urls.length > 1 ? (
            <button
              onClick={(e) => { e.stopPropagation(); setOpenIdx((openIdx - 1 + urls.length) % urls.length); }}
              className="absolute left-4 text-white text-3xl px-3 hover:opacity-70"
            >
              ‹
            </button>
          ) : null}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={urls[openIdx]}
            alt=""
            className="max-h-[85vh] max-w-[85vw] object-contain rounded"
            onClick={(e) => e.stopPropagation()}
          />
          {urls.length > 1 ? (
            <button
              onClick={(e) => { e.stopPropagation(); setOpenIdx((openIdx + 1) % urls.length); }}
              className="absolute right-4 text-white text-3xl px-3 hover:opacity-70"
            >
              ›
            </button>
          ) : null}
          <button
            onClick={() => setOpenIdx(null)}
            className="absolute top-4 right-4 text-white text-xl px-2"
          >
            ✕
          </button>
        </div>
      ) : null}
    </>
  );
}
