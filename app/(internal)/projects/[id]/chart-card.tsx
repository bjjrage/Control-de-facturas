"use client";

import { useState } from "react";
import { Maximize2 } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";

/**
 * Envoltorio para cada gráfico de Informes: lo muestra en su tamaño normal
 * con un botón de ampliar en la esquina, y ese mismo botón abre un diálogo
 * con el gráfico grande. `renderChart` se llama dos veces (chico y grande)
 * en vez de duplicar el JSX del gráfico en cada lugar.
 *
 * `stretch`: cuando dos ChartCard viven en la misma fila de un grid con
 * contenido de alto distinto (ej. una torta con leyenda larga al lado de
 * un gráfico de barras con leyenda corta), el grid ya estira ambas tarjetas
 * a la misma altura — pero el CONTENIDO de la más chica sigue con su alto
 * fijo si no se le dice lo contrario. Con stretch, el gráfico crece con
 * flexbox para ocupar todo el alto que le sobra, en vez de dejar un hueco
 * vacío entre la leyenda y el borde de la tarjeta. El `height` que recibe
 * `renderChart` en este modo es solo un valor de referencia (para el
 * fallback de "sin datos"); el chart en sí debe usar height="100%".
 */
export function ChartCard({
  title,
  smallHeight,
  largeHeight = 460,
  stretch = false,
  renderChart,
  extra,
  className,
}: {
  title: string;
  smallHeight: number;
  largeHeight?: number;
  stretch?: boolean;
  renderChart: (height: number, mode: "small" | "large") => React.ReactNode;
  extra?: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={`rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 ${stretch ? "h-full flex flex-col" : ""} ${className ?? ""}`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="text-[13px] font-semibold">{title}</div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Ampliar"
          className="text-[var(--muted)] hover:text-[var(--foreground)] p-1 -m-1 rounded hover:bg-[var(--hover)]"
        >
          <Maximize2 size={14} />
        </button>
      </div>
      {stretch ? (
        <div className="flex-1 min-h-0">{renderChart(smallHeight, "small")}</div>
      ) : (
        renderChart(smallHeight, "small")
      )}
      {extra}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={title} className="max-w-3xl">
          {renderChart(largeHeight, "large")}
          {extra}
        </DialogContent>
      </Dialog>
    </div>
  );
}
