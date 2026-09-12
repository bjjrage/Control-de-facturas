// Capa de validación técnica PREVIA al matching semántico. Detecta cuando el
// input BIM está internamente contradictorio o expresa un rango que deja más
// de un candidato técnicamente plausible — en esos casos el resultado final
// debe marcarse REVIEW_REQUIRED (ver bim-actions.ts::processBimGroups), sin
// que eso saque a DeepSeek del flujo: DeepSeek sigue proponiendo, el sistema
// solo impide que esa propuesta se confirme con un clic.
//
// A propósito NO es un parser lingüístico general: reutiliza el MISMO
// extractSpecs/normalizeText que ya usa el filtro determinista
// (isTechnicallyCompatible en matching.ts) para no duplicar reglas de
// espesor/resistencia, y agrega solo lo mínimo nuevo: lectura de
// `properties`, clasificación de material por familia de palabras clave, y
// detección de rangos explícitos. Ningún candidato se descarta acá — esto
// solo decide si el resultado final requiere revisión humana obligatoria.
import type { BimElement, BudgetItem } from "@/lib/types";
import { extractSpecs, normalizeText, unitsCompatibleForCosting } from "./matching";

export type IntegrityConflictReason =
  | "CONFLICTING_THICKNESS"
  | "CONFLICTING_STRENGTH"
  | "CONFLICTING_MATERIAL"
  | "AMBIGUOUS_RANGE";

export interface IntegrityCheckResult {
  vicious: boolean;
  reason: IntegrityConflictReason | null;
}

const CLEAN_OK: IntegrityCheckResult = { vicious: false, reason: null };

// ---------------------------------------------------------------------------
// Lectura conservadora de `properties`: solo confía en claves cuyo nombre
// sugiere explícitamente espesor/resistencia — nunca intenta adivinar
// significado de una clave genérica.
// ---------------------------------------------------------------------------
function stitchPropertiesText(properties: Record<string, unknown>): string {
  return Object.entries(properties)
    .filter(([, v]) => typeof v === "string" || typeof v === "number")
    .map(([k, v]) => `${k} ${v}`)
    .join(" ");
}

// Claves que declaran explícitamente un espesor.
const THICKNESS_KEY_RE = /thick|espesor/;

// Claves que declaran OTRA dimensión: nunca se leen como espesor, ni siquiera
// con lenguaje de incertidumbre ("altura: verificar, aprox 250 cm" no es un
// conflicto de espesor).
const OTHER_DIMENSION_KEY_RE =
  /altura|height|largo|length|ancho|width|\barea\b|perimetr|volum|separacion|separation|junta|joint|zocalo|skirting|diametro|diameter|nivel|cota|paso|huella/;

// Evidencia contextual DENTRO del mismo valor de texto libre para poder leer
// una dimensión como espesor. Sin al menos una de las dos, un "separación 20
// cm" / "zócalo 10 cm" / "junta cada 15 cm" NO se interpreta como espesor.
const THICKNESS_WORD_RE = /espesor|thickness|\besp\.|\be\s?=/;
const UNCERTAINTY_RE =
  /podria ser|puede ser|podr[ií]a ser|verificar|revisar|a confirmar|por confirmar|aprox|approx|estimad|tbc|to be confirmed/;

// Un valor de texto libre solo aporta un espesor candidato si (a) su clave no
// es de otra dimensión, (b) hay evidencia contextual de espesor o de
// incertidumbre sobre una dimensión, y (c) la dimensión trae unidad
// EXPLÍCITA (mm/cm) — los números sin unidad nunca se interpretan.
function thicknessFromFreeTextValue(key: string, value: string): number | null {
  if (OTHER_DIMENSION_KEY_RE.test(normalizeText(key))) return null;
  const haystack = `${value.toLowerCase()} ${normalizeText(value)}`;
  if (!THICKNESS_WORD_RE.test(haystack) && !UNCERTAINTY_RE.test(haystack)) return null;
  return extractSpecs(value).thicknessMm;
}

function declaredThicknessMmFromProperties(properties: Record<string, unknown>): number | null {
  // 1) Claves estructuradas que nombran explícitamente el espesor.
  for (const [key, value] of Object.entries(properties)) {
    const k = key.toLowerCase();
    if (!THICKNESS_KEY_RE.test(k)) continue;
    if (typeof value === "number") {
      if (/mm/.test(k)) return value;
      if (/cm/.test(k)) return value * 10;
      // Sin unidad en la clave ni en el valor: no se asume nada.
      continue;
    }
    if (typeof value === "string") {
      const specs = extractSpecs(value);
      if (specs.thicknessMm != null) return specs.thicknessMm;
    }
  }

  // 2) Texto libre (notas de obra, observaciones) con evidencia contextual.
  for (const [key, value] of Object.entries(properties)) {
    if (typeof value !== "string") continue;
    const mm = thicknessFromFreeTextValue(key, value);
    if (mm != null) return mm;
  }

  return null;
}

// Token de grado/resistencia normalizado: "h30" o "ca60" (sin espacios ni
// guiones). Cubre hormigón (H-xx) y acero (CA-xx) con la misma lógica — son
// las dos únicas notaciones de grado que existen hoy en el dominio.
function extractGradeToken(text: string): string | null {
  const norm = normalizeText(text);
  const h = norm.match(/\bh\s?-?\s?(\d{2,3})\b/);
  if (h) return `h${h[1]}`;
  const ca = norm.match(/\bca\s?-?\s?(\d{2,3})\b/);
  if (ca) return `ca${ca[1]}`;
  return null;
}

function declaredGradeFromProperties(properties: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(properties)) {
    const k = key.toLowerCase();
    if (!/resist|strength|grado|grade/.test(k)) continue;
    if (typeof value === "string") {
      const token = extractGradeToken(value);
      if (token) return token;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Clasificación de material por familia de palabras clave — deliberadamente
// chica y explícita. Si ninguna familia reconoce el texto, no se opina (nunca
// se fuerza un conflicto sobre una clasificación insegura).
// ---------------------------------------------------------------------------
const MATERIAL_FAMILIES: Array<[string, RegExp]> = [
  ["concrete_block", /bloque\s+hueco.*hormig[oó]n|concrete\s+block/i],
  ["common_brick", /ladrillo\s+com[uú]n|common\s+brick/i],
  ["ceramic", /cer[aá]mic/i],
  ["concrete", /concrete|hormig[oó]n/i],
  ["wood", /\bmadera\b|\bwood\b/i],
  ["steel", /\bacero\b|\bsteel\b|\bca-?\d{2,3}\b/i],
  ["porcelain", /porcelanato|porcelain/i],
  ["vinyl", /vin[ií]lico|\bvinyl\b/i],
];

function classifyMaterial(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const [family, re] of MATERIAL_FAMILIES) {
    if (re.test(text)) return family;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rango explícito de espesor ("15-18cm", "entre 15 y 18 cm", "15 a 18 cm",
// "between 15 and 18 cm", variantes es/en/pt razonables). Devuelve el rango
// en mm, o null si no hay un rango reconocible.
// ---------------------------------------------------------------------------
// Normalización suave para rangos: baja a minúsculas y saca acentos, pero
// PRESERVA el guión — normalizeText() lo convierte en espacio y haría
// indetectable la forma "15-18 cm".
function softNormalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractThicknessRangeMm(text: string): { minMm: number; maxMm: number } | null {
  const norm = softNormalize(text);
  const toMm = (value: string, unit: string) => {
    const n = parseFloat(value.replace(",", "."));
    return unit === "mm" ? n : n * 10;
  };

  const patterns: RegExp[] = [
    /entre\s+(\d+(?:[.,]\d+)?)\s*(?:cm|mm)?\s*(?:y|a|e|and|to)\s+(\d+(?:[.,]\d+)?)\s*(cm|mm)\b/,
    /(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)\s*(cm|mm)\b/,
    /(\d+(?:[.,]\d+)?)\s*(?:a|to)\s*(\d+(?:[.,]\d+)?)\s*(cm|mm)\b/,
  ];

  for (const re of patterns) {
    const m = norm.match(re);
    if (!m) continue;
    const [, lo, hi, unit] = m;
    const minMm = toMm(lo, unit);
    const maxMm = toMm(hi, unit);
    if (Number.isFinite(minMm) && Number.isFinite(maxMm) && maxMm > minMm) {
      return { minMm, maxMm };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Punto de entrada único. `matchableItems` son los rubros COMPLETOS del
// proyecto (hoja + con precio), NO el pool ya filtrado por buildCandidatePool:
// ese filtro resuelve el espesor con una lectura única del texto y, ante un
// rango ("entre 15 y 18 cm"), se queda con un solo extremo — con lo cual la
// ambigüedad ya venía colapsada y era indetectable acá. Este chequeo hace su
// propio conteo (unidad costeable + espesores distintos dentro del rango) sin
// modificar ni reemplazar el retrieval: no descarta candidatos, solo decide si
// el resultado final requiere revisión humana obligatoria.
// ---------------------------------------------------------------------------
export function checkTechnicalIntegrity(element: BimElement, matchableItems: BudgetItem[]): IntegrityCheckResult {
  const nameText = element.name ?? "";
  const materialField = element.material ?? "";
  const properties = element.properties ?? {};

  // 1) Material: familia derivada del nombre vs. familia derivada del campo
  // `material` — solo se opina si AMBAS clasifican con confianza y difieren.
  const nameMaterialFamily = classifyMaterial(nameText);
  const fieldMaterialFamily = classifyMaterial(materialField);
  if (nameMaterialFamily && fieldMaterialFamily && nameMaterialFamily !== fieldMaterialFamily) {
    return { vicious: true, reason: "CONFLICTING_MATERIAL" };
  }

  // 2) Espesor: extraído de texto (name/material/ifc_type, igual que el
  // filtro determinista) vs. declarado explícitamente en `properties`.
  const textSpecs = extractSpecs([nameText, materialField, element.ifc_type].filter(Boolean).join(" "));
  const declaredThicknessMm = declaredThicknessMmFromProperties(properties);
  if (textSpecs.thicknessMm != null && declaredThicknessMm != null) {
    // Mismo criterio de "distinto" que matching.ts (más de un límite de
    // redondeo de catálogo entre ambos valores).
    if (Math.abs(textSpecs.thicknessMm - declaredThicknessMm) > 15) {
      return { vicious: true, reason: "CONFLICTING_THICKNESS" };
    }
  }

  // 3) Resistencia/grado: mismo patrón, comparando token de texto vs.
  // token declarado en `properties`.
  const textGrade = extractGradeToken(nameText) ?? extractGradeToken(materialField);
  const declaredGrade = declaredGradeFromProperties(properties);
  if (textGrade && declaredGrade && textGrade !== declaredGrade) {
    return { vicious: true, reason: "CONFLICTING_STRENGTH" };
  }

  // 4) Rango explícito que deja más de un candidato plausible.
  const combinedText = [nameText, materialField, stitchPropertiesText(properties)].filter(Boolean).join(" ");
  const range = extractThicknessRangeMm(combinedText);
  if (range) {
    // Se cuentan ESPESORES DISTINTOS, no ítems: dos materiales al mismo
    // espesor (cerámico 15 vs ladrillo común 15) no es ambigüedad de rango
    // — eso lo desambigua el matcher semántico por material.
    const distinctThicknesses = new Set<number>();
    for (const item of matchableItems) {
      if (!unitsCompatibleForCosting(element.quantity_unit, item.unit)) continue;
      const mm = extractSpecs(item.description).thicknessMm;
      if (mm != null && mm >= range.minMm && mm <= range.maxMm) distinctThicknesses.add(mm);
    }
    if (distinctThicknesses.size > 1) {
      return { vicious: true, reason: "AMBIGUOUS_RANGE" };
    }
  }

  return CLEAN_OK;
}
