"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createReceiptPortalLink } from "@/app/(internal)/inventory/actions";

function PortalLinkActions({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const absoluteUrl = () => new URL(url, window.location.origin).toString();

  async function copy() {
    try {
      await navigator.clipboard.writeText(absoluteUrl());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-2 rounded border border-[var(--border)] bg-[var(--panel-2)] p-3">
      <p className="break-all text-xs text-[var(--muted)]">{url}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={copy}>
          {copied ? "Enlace copiado" : "Copiar enlace"}
        </Button>
        <a className="text-action inline-flex h-8 items-center text-xs" href={url} target="_blank" rel="noreferrer">
          Abrir portal
        </a>
      </div>
      <p className="text-[11px] text-[var(--muted)]">El enlace vence en 7 días, se usa una sola vez y reemplaza cualquier enlace activo anterior de esta OC.</p>
    </div>
  );
}

export function ReceiptPortalLink({ orderId }: { orderId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function createLink() {
    setPending(true);
    setError(null);
    try {
      const result = await createReceiptPortalLink(orderId);
      if (result.error || !result.url) {
        setError(result.error ?? "No se pudo crear el enlace.");
      } else {
        setUrl(result.url);
      }
    } catch {
      setError("No se pudo crear el enlace. Intentá nuevamente.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="secondary" className="h-8 px-3 text-[12px]" onClick={createLink} disabled={pending}>
        {pending ? "Creando enlace…" : "Crear enlace de recepción"}
      </Button>
      {error ? <p role="alert" className="text-xs text-[var(--error)]">{error}</p> : null}
      {url ? <PortalLinkActions url={url} /> : null}
    </div>
  );
}
