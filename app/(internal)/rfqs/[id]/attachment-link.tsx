"use client";

import { useState } from "react";
import { getSignedAttachmentUrl } from "./actions";
import { Button } from "@/components/ui/button";
import { FileText } from "lucide-react";

export function AttachmentLink({
  bucket,
  path,
  fileName,
}: {
  bucket: string;
  path: string;
  fileName: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <><Button
      type="button"
      disabled={loading}
      variant="secondary" size="sm" className="max-w-full whitespace-normal text-left"
      onClick={async () => {
        setLoading(true);
        setError(null);
        try {
          const result = await getSignedAttachmentUrl(bucket, path);
          if (result.error || !result.url) { setError(result.error ?? "No se pudo abrir el archivo."); return; }
          window.open(result.url, "_blank", "noopener,noreferrer");
        } catch (e) { setError(e instanceof Error ? e.message : "No se pudo abrir el archivo."); }
        finally { setLoading(false); }
      }}
    >
      <FileText size={14} aria-hidden="true" className="shrink-0" /> {loading ? "Abriendo…" : fileName}
    </Button>{error && <span role="alert" className="block text-[var(--error)]">{error}</span>}</>
  );
}
