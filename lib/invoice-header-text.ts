import type { CurrencyCode } from "./types";
/** Read only explicit, unambiguous printed header fields; never derive amounts. */
export function printedMoney(text: string): number | null {
  const value = text.replace(/\s/g, "");
  if (!/^[0-9][0-9.,]*$/.test(value)) return null;
  const comma=value.lastIndexOf(","),dot=value.lastIndexOf(".");
  const last=Math.max(comma,dot);
  let normalized=value;
  if(last>=0 && value.length-last-1<=2) {
    const integer=value.slice(0,last).replace(/[.,]/g, "");
    normalized=integer+"."+value.slice(last+1);
  } else if(last>=0) {
    if(!/^[1-9][0-9]{0,2}([.,][0-9]{3})+$/.test(value)) return null;
    normalized=value.replace(/[.,]/g, "");
  }
  const result=Number(normalized);
  return Number.isFinite(result) && result>=0 ? result : null;
}
export function printedInvoiceHeader(text: string): { subtotal?: number; vat?: number; total?: number; currency?: CurrencyCode } {
  const result: {subtotal?:number;vat?:number;total?:number;currency?:CurrencyCode}={};
  const amount="([0-9][0-9., ]*)(?:\\s*(?:PYG|USD|EUR|BRL|ARS|Gs\\.?|₲))?\\s*$";
  const read=(pattern:string) => {
    const matches=[...text.matchAll(new RegExp("^\\s*"+pattern+"\\s*[:=]\\s*"+amount,"gim"))];
    const values=matches.map(m=>printedMoney(m[1]));
    if(!values.length || values.some(v=>v===null))return undefined;
    const unique=[...new Set(values)];return unique.length===1?unique[0]!:undefined;
  };
  result.subtotal=read("subtotal(?:\\s+sin\\s+iva)?(?:\\s+de\\s+cabecera)?");
  result.vat=read("iva\\s+total") ?? read("iva(?:\\s+(?:5|10)\\s*%)?");
  result.total=read("total(?:\\s+(?:con\\s+iva|iva\\s+incluido))?");
  const currencies=[...text.matchAll(/^\s*Moneda\s*:\s*(PYG|USD|EUR|BRL|ARS)\b/gim)].map(m=>m[1].toUpperCase());
  if(new Set(currencies).size===1)result.currency=currencies[0] as CurrencyCode;
  return Object.fromEntries(Object.entries(result).filter(([,value])=>value!==undefined));
}
