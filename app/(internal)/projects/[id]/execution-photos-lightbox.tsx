"use client";

import { useState } from "react";

export type LightboxPhoto = {
  url: string;
  source: string | null;
  capturedAt: string | null;
  lat: number | null;
  lng: number | null;
};

function fmtTs(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("es-PY", { dateStyle: "short", timeStyle: "short" });
}

function VerificationBar({ photo }: { photo: LightboxPhoto }) {
  const ts = fmtTs(photo.capturedAt);
  const hasGps = photo.lat != null && photo.lng != null;
  if (!ts && !hasGps && !photo.source) return null;

  return (
    <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white px-4 py-2 text-[12px] flex flex-wrap items-center gap-x-4 gap-y-1">
      {photo.source === "camara" ? (
        <span className="text-emerald-400">✓ Cámara verificada</span>
      ) : photo.source === "archivo" ? (
        <span className="text-amber-400">Foto de archivo</span>
      ) : null}
      {ts ? <span>{ts}</span> : null}
      {hasGps ? (
        <a
          href={`https://www.google.com/maps?q=${photo.lat},${photo.lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
          onClick={(e) => e.stopPropagation()}
        >
          Ver ubicación
        </a>
      ) : (
        <span className="text-white/60">Sin ubicación</span>
      )}
    </div>
  );
}

export function ExecutionPhotosLightbox({ photos }: { photos: LightboxPhoto[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  if (photos.length === 0) return <span className="text-[var(--muted)]">—</span>;

  return (
    <>
      <div className="flex gap-1">
        {photos.map((p, i) => (
          <span key={i} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.url}
              alt=""
              onClick={() => setOpenIdx(i)}
              className="h-8 w-8 object-cover rounded cursor-pointer border border-[var(--border)] hover:opacity-80"
            />
            {p.source === "camara" && p.lat != null ? (
              <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-[var(--ok)] border border-white" />
            ) : null}
          </span>
        ))}
      </div>
      {openIdx !== null ? (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center"
          onClick={() => setOpenIdx(null)}
        >
          {photos.length > 1 ? (
            <button
              onClick={(e) => { e.stopPropagation(); setOpenIdx((openIdx - 1 + photos.length) % photos.length); }}
              className="absolute left-4 text-white text-3xl px-3 hover:opacity-70"
            >
              ‹
            </button>
          ) : null}
          <div className="relative max-h-[85vh] max-w-[85vw]" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photos[openIdx].url}
              alt=""
              className="max-h-[85vh] max-w-[85vw] object-contain rounded"
            />
            <VerificationBar photo={photos[openIdx]} />
          </div>
          {photos.length > 1 ? (
            <button
              onClick={(e) => { e.stopPropagation(); setOpenIdx((openIdx + 1) % photos.length); }}
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
