"use client";

import { useState } from "react";
import { Maximize2 } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";

/**
 * Envoltorio para cada gráfico de Informes: lo muestra en su tamaño normal
 * con un botón de ampliar en la esquina, y ese mismo botón abre un diálogo
 * con el gráfico grande. `renderChart` se llama dos veces (chico y grande)
 * en vez de duplicar el JSX del gráfico en cada lugar.
 */
export function ChartCard({
  title,
  smallHeight,
  largeHeight = 460,
  renderChart,
  extra,
  className,
}: {
  title: string;
  smallHeight: number;
  largeHeight?: number;
  renderChart: (height: number) => React.ReactNode;
  extra?: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 ${className ?? ""}`}>
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
      {renderChart(smallHeight)}
      {extra}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={title} className="max-w-3xl">
          {renderChart(largeHeight)}
          {extra}
        </DialogContent>
      </Dialog>
    </div>
  );
}
