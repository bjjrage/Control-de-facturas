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

  return (
    <button
      type="button"
      disabled={loading}
      className="text-[12px] text-[var(--primary)] underline hover:no-underline disabled:opacity-50"
      onClick={async () => {
        setLoading(true);
        const result = await getSignedAttachmentUrl(bucket, path);
        setLoading(false);
        if (result.url) window.open(result.url, "_blank", "noopener,noreferrer");
      }}
    >
      {loading ? "Abriendo…" : fileName}
    </button>
  );
}
