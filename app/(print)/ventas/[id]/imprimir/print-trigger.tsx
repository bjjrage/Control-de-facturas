"use client";

import { useEffect } from "react";

/** Abre el diálogo de impresión al cargar la página. */
export function PrintTrigger() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, []);
  return null;
}
