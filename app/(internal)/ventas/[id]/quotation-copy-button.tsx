"use client";

import { useState } from "react";

export function CopyButton({ text, onCopied }: { text: string; onCopied?: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          onCopied?.();
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Portapapeles no disponible: el usuario copia manual desde el input.
        }
      }}
      className="rounded-md border border-[var(--border)] px-2 h-8 text-[12px] bg-[var(--panel)] hover:bg-[var(--hover)] shrink-0"
    >
      {copied ? "¡Copiado!" : "Copiar"}
    </button>
  );
}
