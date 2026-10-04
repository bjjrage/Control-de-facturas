import type { CurrencyCode } from "@/lib/types";
import { formatMoney } from "@/lib/format";
import type { FlujoItem } from "@/lib/flujo-caja";
import { buildCanonicalCashflow } from "@/lib/cashflow/model";
import { addCashDays, financialWindow } from "@/lib/cashflow/dates";
import type { CashflowSources } from "@/lib/cashflow/types";
import type { DomainTone } from "./types";

export interface RawSalesDocForCashflow {
  id: string;
  code?: string | null;
  total: number;
  cobrado_amount: number;
  currency: string;
  due_date: string | null;
  issue_date: string | null;
}

export interface RawCertificateForCashflow {
  id: string;
  numero: string;
  project_id: string;
  monto_liquido: number;
  status: string;
  period_end?: string | null;
  aprobado_at?: string | null;
  facturado_at?: string | null;
  sales_documents?: { id: string; status: string } | { id: string; status: string }[] | null;
}

export interface RawInvoiceForCashflow {
  id: string;
  invoice_number: string;
  total: number;
  currency: string;
  due_date: string | null;
  invoice_date?: string | null;
  status: string;
}

export interface RawGastoRecurrenteForCashflow {
  id: string;
  descripcion: string;
  monto_estimado: number;
  periodicidad: string;
  dia_del_mes: number | null;
  proximo_vencimiento: string | null;
  moneda: CurrencyCode;
  activo: boolean;
  project_id: string | null;
}

/** Compatibility adapter for older callers; all financial decisions use B09. */
export function build30DayCashflowItems(params: {
  todayIso: string; ventaDocs: RawSalesDocForCashflow[];
  certificados: RawCertificateForCashflow[]; comprasInv: RawInvoiceForCashflow[];
  gastos: RawGastoRecurrenteForCashflow[];
}): FlujoItem[] {
  const empresa_id="legacy-adapter", stamp=<T extends object>(r:T)=>({...r,empresa_id});
  const s:CashflowSources={empresa_id,read_at:params.todayIso+"T00:00:00Z",from:params.todayIso,until:addCashDays(params.todayIso,30),
    accounts:[],projects:[...new Set([...params.certificados.map(c=>c.project_id),...params.gastos.flatMap(g=>g.project_id?[g.project_id]:[])])].map(id=>({id,empresa_id})),
    expenses:params.gastos.map(stamp) as CashflowSources["expenses"],
    sales:params.ventaDocs.map(d=>({...stamp(d),status:"EMITIDA"})),
    certificates:params.certificados.map(c=>({...stamp(c),sales_documents:Array.isArray(c.sales_documents)?c.sales_documents:c.sales_documents?[c.sales_documents]:[]})),
    invoices:params.comprasInv.map(stamp),receipts:[],orders:[],invoice_links:[],payments:[],payment_links:[],movements:[],labor_payments:[],subcontracts:[],planning:[]};
  return financialWindow(buildCanonicalCashflow(s,empresa_id),s.from,s.until).map(i=>({...i,ref_id:i.source_type==="RECURRING_EXPENSE"?i.source_id+"-"+i.fecha:(i.source_id??i.ref_id)}));
}


/**
 * Calcula el flujo neto a 30 días para una moneda específica (por defecto PYG).
 */
export function calculate30DayNetCashflow(
  items: FlujoItem[],
  moneda: CurrencyCode = "PYG"
): {
  neto: number;
  entradas: number;
  salidas: number;
  formattedNeto: string;
  tone: DomainTone;
} {
  let entradas = 0;
  let salidas = 0;

  for (const item of items) {
    if (item.moneda !== moneda || item.certainty === "ACTUAL" || item.fecha === null) continue;
    if (item.monto >= 0) {
      entradas += item.monto;
    } else {
      salidas += Math.abs(item.monto);
    }
  }

  const neto = Math.round(entradas - salidas);
  const sign = neto > 0 ? "+" : "";
  const formattedNeto = `${sign}${formatMoney(neto, moneda)}`;

  let tone: DomainTone = "ok";
  if (neto < 0) {
    tone = "error";
  } else if (neto === 0 && salidas > 0) {
    tone = "warn";
  }

  return {
    neto,
    entradas: Math.round(entradas),
    salidas: Math.round(salidas),
    formattedNeto,
    tone,
  };
}
