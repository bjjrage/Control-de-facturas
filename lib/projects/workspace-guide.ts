import type { IWorkbookData } from "@univerjs/presets";

export const WORKSPACE_GUIDE: Record<string, { name: string; text: string; legacy: string }> = {
  computo: { name: "Cómputo", text: "Cantidad directa tiene prioridad. Sin ella: Veces × Largo × Alto para m²; Veces × Largo × Ancho × Alto para m³.", legacy: "Escribí desde la fila 4. Unidad: m2, m3, m, un o gl. Cantidad directa tiene prioridad sobre dimensiones." },
  presupuesto: { name: "Presupuesto", text: "Usá el código del Cómputo e ingresá el precio de venta. Las celdas celestes se calculan.", legacy: "A: código de la partida del Cómputo. G: precio de venta. El vínculo por código conserva el precio al ordenar filas." },
  apu: { name: "APU", text: "Una fila por recurso: MAT, MO o EQ. MO usa horas/persona por unidad. Desperdicio: ingresá 5 para 5%.", legacy: "Una fila por recurso. Tipo: MAT, MO o EQ. Código de partida = Cómputo. MO usa horas/persona por unidad." },
  materiales: { name: "Materiales", text: "Se agrupan los recursos MAT por código. La necesidad es teórica; stock y presentaciones se validan al comprar.", legacy: "Consolidado automático por código de recurso MAT. Necesidad teórica; revisar stock y presentaciones antes de comprar." },
  cronograma: { name: "Cronograma", text: "Ingresá código, personas, jornada, inicio y calendario: L-V, L-S o Todos. Días manuales reemplaza el plazo estimado por APU.", legacy: "A: código de partida. Calendario: L-V, L-S o Todos. J permite un plazo manual; si está vacío se usa el APU, personas y jornada." },
};

/** Remove only unchanged template instructions from older drafts. Preserve
 * user notes and every input, formula, format and worksheet coordinate. */
export function compactProjectWorkbook(workbook: IWorkbookData): IWorkbookData {
  const copy = structuredClone(workbook);
  for (const [id, guide] of Object.entries(WORKSPACE_GUIDE)) {
    const cell = copy.sheets[id]?.cellData?.[1]?.[0];
    if (cell?.v === guide.legacy && !cell.p) delete cell.v;
  }
  return copy;
}
