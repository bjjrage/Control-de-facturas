/**
 * Validador aritmético determinístico para extracciones de facturas.
 *
 * Independiente del LLM: solo comprueba matemática sobre los campos que el
 * extractor declara legibles. Nunca inventa valores; cuando falta un dato, la
 * comprobación que lo necesita se omite y el resultado exige revisión.
 *
 * Tolerancia: los montos en guaraníes son enteros; se acepta ±1 PYG por
 * redondeos de prorrateo (p. ej. base = round(total/11)).
 */

import type { ExtractedInvoiceFields, ExtractedInvoiceItem } from "./invoice-extraction";

export type ArithmeticStatus = "VALIDA" | "REVISION";

export type ArithmeticValidation = {
  status: ArithmeticStatus;
  issues: string[];
};

const EPS = 1;

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function closeEnough(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPS;
}

export function validateInvoiceLine(item: ExtractedInvoiceItem, index: number): string[] {
  const issues: string[] = [];
  const qty = num(item.quantity);
  const pu = num(item.unit_price);
  const sub = num(item.subtotal);
  if (qty !== null && pu !== null && sub !== null) {
    if (!closeEnough(qty * pu, sub)) {
      issues.push(`Línea ${index + 1} ("${item.description}"): ${qty} × ${pu} = ${qty * pu}, pero el documento indica ${sub}.`);
    }
  }
  if (qty !== null && qty <= 0) issues.push(`Línea ${index + 1} ("${item.description}"): cantidad no positiva.`);
  if (pu !== null && pu < 0) issues.push(`Línea ${index + 1} ("${item.description}"): precio unitario negativo.`);
  if (sub !== null && sub < 0) issues.push(`Línea ${index + 1} ("${item.description}"): subtotal negativo.`);
  return issues;
}

export function validateInvoiceArithmetic(parsed: ExtractedInvoiceFields): ArithmeticValidation {
  const issues: string[] = [];

  for (let i = 0; i < (parsed.items ?? []).length; i++) {
    issues.push(...validateInvoiceLine(parsed.items[i], i));
  }

  const subtotal = num(parsed.subtotal);
  const vat = num(parsed.vat);
  const total = num(parsed.total);

  if (total === null || total <= 0) {
    issues.push("Total no legible o no positivo: no se puede validar ni aceptar como definitivo.");
  }
  if (vat !== null && vat < 0) issues.push("IVA negativo.");
  if (subtotal !== null && subtotal < 0) issues.push("Subtotal negativo.");

  // Amarre de la suma de líneas: debe empatar con el subtotal o con el total.
  // Si no empata con ninguno, hay descuentos, exentos o precios con IVA incluido
  // no desagregados (o un total impreso erróneo): se pide revisión, nunca se asume.
  const lineSubtotals = (parsed.items ?? []).map((item) => num(item.subtotal));
  const allLinesStated = lineSubtotals.length > 0 && lineSubtotals.every((s) => s !== null);
  if (total !== null && total > 0 && allLinesStated) {
    const linesSum = (lineSubtotals as number[]).reduce((s, v) => s + v, 0);
    const tiesToTotal = closeEnough(linesSum, total);
    const tiesToSubtotal = subtotal !== null && closeEnough(linesSum, subtotal);
    const subtotalTiesToTotal = subtotal !== null && vat !== null && closeEnough(subtotal + vat, total);
    if (!tiesToTotal && !(tiesToSubtotal && subtotalTiesToTotal)) {
      issues.push(`Suma de líneas (${linesSum}) no concilia con la cabecera (subtotal ${subtotal ?? "—"} / total ${total}): puede haber descuentos, exentos o un total impreso erróneo. Requiere revisión humana.`);
    }
  }

  // Coherencia subtotal + IVA = total, solo cuando los tres están presentes.
  if (subtotal !== null && vat !== null && total !== null && total > 0) {
    if (!closeEnough(subtotal + vat, total)) {
      issues.push(`Inconsistencia aritmética: subtotal (${subtotal}) + IVA (${vat}) = ${subtotal + vat}, pero el total es ${total}. Requiere revisión humana.`);
    }
  }

  return { status: issues.length ? "REVISION" : "VALIDA", issues };
}
