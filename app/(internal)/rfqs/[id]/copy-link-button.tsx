"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <span><Button
      type="button"
      variant="secondary" size="sm"
      onClick={async () => {
        setError(null);
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch { setError("No se pudo copiar. Abrí el portal y copiá su dirección."); }
      }}
    >
      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      {copied ? "Copiado" : "Copiar enlace"}
    </Button>{error && <span role="alert" className="block text-[var(--error)]">{error}</span>}</span>
  );
}
