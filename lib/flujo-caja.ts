// Proyección de flujo de caja (Partes B2–B4 del plan).
//
// La ecuación: saldo de hoy + entradas futuras − salidas futuras, ordenado en
// el tiempo. Todo lo de acá es cálculo puro sobre datos que ya existen — no hay
// tabla nueva de proyección.

import type { CurrencyCode } from "@/lib/types";

export type FlujoItemTipo =
  | "cobro_factura"
  | "cobro_certificado"
  | "pago_factura"
  | "gasto_recurrente";

export interface FlujoItem {
  tipo: FlujoItemTipo;
  descripcion: string;
  fecha: string | null; // ISO date; null = sin fecha conocida
  monto: number; // + entra, - sale
  moneda: CurrencyCode;
  project_id: string | null;
  ref_id: string;
}

export interface PeriodoFlujo {
  clave: string; // "2026-09" o "2026-W37"
  etiqueta: string;
  desde: string;
  hasta: string;
  entradas: number;
  salidas: number;
  neto: number;
  saldoAcumulado: number;
  items: FlujoItem[];
}

export interface ProyeccionFlujo {
  moneda: CurrencyCode;
  saldoInicial: number;
  periodos: PeriodoFlujo[];
  sinFecha: FlujoItem[];
  primerPeriodoNegativo: string | null;
  totalEntradas: number;
  totalSalidas: number;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // lunes = 0
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((t.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/**
 * Construye la proyección para una moneda dada.
 * @param granularidad "semana" (12 semanas) o "mes" (6 meses)
 */
export function construirProyeccion(
  saldoInicial: number,
  items: FlujoItem[],
  moneda: CurrencyCode,
  granularidad: "semana" | "mes",
  projectId: string | null
): ProyeccionFlujo {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const filtrados = items.filter(
    (i) => i.moneda === moneda && (projectId === null || i.project_id === projectId)
  );

  // Buckets
  const periodos: PeriodoFlujo[] = [];
  const nPeriodos = granularidad === "semana" ? 12 : 6;

  for (let k = 0; k < nPeriodos; k++) {
    let desde: Date;
    let hasta: Date;
    let clave: string;
    let etiqueta: string;
    if (granularidad === "semana") {
      desde = startOfWeek(hoy);
      desde.setDate(desde.getDate() + k * 7);
      hasta = new Date(desde);
      hasta.setDate(hasta.getDate() + 7);
      clave = isoWeek(desde);
      etiqueta = `Sem ${ymd(desde).slice(5)}`;
    } else {
      desde = new Date(hoy.getFullYear(), hoy.getMonth() + k, 1);
      hasta = new Date(hoy.getFullYear(), hoy.getMonth() + k + 1, 1);
      clave = `${desde.getFullYear()}-${String(desde.getMonth() + 1).padStart(2, "0")}`;
      etiqueta = `${MESES[desde.getMonth()]} ${desde.getFullYear()}`;
    }
    periodos.push({
      clave,
      etiqueta,
      desde: ymd(desde),
      hasta: ymd(hasta),
      entradas: 0,
      salidas: 0,
      neto: 0,
      saldoAcumulado: 0,
      items: [],
    });
  }

  const finVentana = periodos[periodos.length - 1].hasta;
  const sinFecha: FlujoItem[] = [];

  for (const item of filtrados) {
    if (!item.fecha) {
      sinFecha.push(item);
      continue;
    }
    // Ítems vencidos (fecha < hoy) se cargan al primer período.
    const fechaEfectiva = item.fecha < ymd(hoy) ? ymd(hoy) : item.fecha;
    if (fechaEfectiva >= finVentana) continue; // fuera de la ventana

    const p = periodos.find((pp) => fechaEfectiva >= pp.desde && fechaEfectiva < pp.hasta);
    if (!p) continue;
    p.items.push(item);
    if (item.monto >= 0) p.entradas += item.monto;
    else p.salidas += -item.monto;
  }

  let acumulado = saldoInicial;
  let primerNegativo: string | null = null;
  let totalEntradas = 0;
  let totalSalidas = 0;

  for (const p of periodos) {
    p.neto = p.entradas - p.salidas;
    acumulado += p.neto;
    p.saldoAcumulado = acumulado;
    totalEntradas += p.entradas;
    totalSalidas += p.salidas;
    if (acumulado < 0 && primerNegativo === null) primerNegativo = p.clave;
  }

  return {
    moneda,
    saldoInicial,
    periodos,
    sinFecha,
    primerPeriodoNegativo: primerNegativo,
    totalEntradas,
    totalSalidas,
  };
}

/**
 * Proyecta las ocurrencias de un gasto recurrente dentro de una ventana.
 */
export function ocurrenciasGastoRecurrente(
  monto: number,
  periodicidad: string,
  diaDelMes: number | null,
  proximoVencimiento: string | null,
  hasta: Date
): { fecha: string; monto: number }[] {
  const pasoMeses: Record<string, number> = {
    MENSUAL: 1,
    BIMESTRAL: 2,
    TRIMESTRAL: 3,
    SEMESTRAL: 6,
    ANUAL: 12,
  };
  const paso = pasoMeses[periodicidad] ?? 1;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  let cursor: Date;
  if (proximoVencimiento) {
    cursor = new Date(proximoVencimiento);
  } else {
    const dia = diaDelMes ?? hoy.getDate();
    cursor = new Date(hoy.getFullYear(), hoy.getMonth(), dia);
    if (cursor < hoy) cursor = new Date(hoy.getFullYear(), hoy.getMonth() + 1, dia);
  }
  cursor.setHours(0, 0, 0, 0);

  const out: { fecha: string; monto: number }[] = [];
  let guard = 0;
  while (cursor < hasta && guard < 60) {
    if (cursor >= hoy) out.push({ fecha: ymd(cursor), monto });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + paso, diaDelMes ?? cursor.getDate());
    guard++;
  }
  return out;
}
