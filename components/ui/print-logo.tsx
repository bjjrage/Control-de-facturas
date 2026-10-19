"use client";

import { useCallback, useState } from "react";

/** Missing branding must not print a broken-image placeholder. */
export function PrintLogo({ src, className }: { src: string; className?: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const ref = useCallback((image: HTMLImageElement | null) => {
    if (image?.complete && image.naturalWidth === 0) setFailedSrc(src);
  }, [src]);
  if (failedSrc === src) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} src={src} alt="Logo de la empresa" className={className} onError={() => setFailedSrc(src)} />;
}
