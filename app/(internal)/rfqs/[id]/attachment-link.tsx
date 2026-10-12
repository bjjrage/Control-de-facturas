"use client";

import { useState } from "react";
import { getSignedAttachmentUrl } from "./actions";

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
    <><button
      type="button"
      disabled={loading}
      className="text-[12px] text-[var(--primary)] underline hover:no-underline disabled:opacity-50"
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
      {loading ? "Abriendo…" : fileName}
    </button>{error && <span role="alert" className="block text-[var(--error)]">{error}</span>}</>
  );
}
