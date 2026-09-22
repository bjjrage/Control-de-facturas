"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function PortalLinkActions({ url, label }: { url: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const absoluteUrl = typeof window === "undefined" ? url : new URL(url, window.location.origin).toString();

  async function copy() {
    try {
      await navigator.clipboard.writeText(absoluteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      const input = document.createElement("textarea");
      input.value = absoluteUrl;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.append(input);
      input.select();
      const copiedToClipboard = document.execCommand("copy");
      input.remove();
      setCopied(copiedToClipboard);
    }
  }

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: label, text: label, url: absoluteUrl });
        return;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
      }
    }
    await copy();
  }

  const whatsapp = `https://wa.me/?text=${encodeURIComponent(`${label}: ${absoluteUrl}`)}`;
  return (
    <div className="space-y-2">
      <a className="block break-all rounded border border-[var(--border)] bg-[var(--panel-2)] p-2 text-xs text-action" href={absoluteUrl} target="_blank" rel="noreferrer">
        {absoluteUrl}
      </a>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={copy}>{copied ? "Enlace copiado" : "Copiar enlace"}</Button>
        <Button type="button" variant="secondary" size="sm" onClick={share}>Compartir</Button>
        <a className="btn-base btn-secondary inline-flex h-8 items-center justify-center rounded-lg border px-2.5 text-[11px] font-medium" href={whatsapp} target="_blank" rel="noreferrer">WhatsApp</a>
      </div>
    </div>
  );
}
