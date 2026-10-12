"use client";

import { useState } from "react";

export function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <span><button
      type="button"
      className="text-[12px] text-[var(--primary)] underline hover:no-underline"
      onClick={async () => {
        setError(null);
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch { setError("No se pudo copiar. Abrí el portal y copiá su dirección."); }
      }}
    >
      {copied ? "Copiado" : "Copiar enlace"}
    </button>{error && <span role="alert" className="block text-[var(--error)]">{error}</span>}</span>
  );
}
