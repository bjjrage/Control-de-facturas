// Extrae filas de cómputo métrico (descripción/cantidad/unidad) del texto de
// un PDF, con un gate de confianza de 3 capas — nunca confía ciegamente en un
// PDF cualquiera:
//
//   1. Señal estructural (determinística, gratis): ¿el PDF tiene capa de
//      texto real, o es un escaneo/foto sin texto extraíble? Si no hay texto
//      suficiente, se corta ACÁ, sin gastar un solo token de IA.
//   2. Confianza auto-reportada por DeepSeek: además de las filas, el modelo
//      dice si encontró una tabla clara o tuvo que adivinar.
//   3. Chequeo de sanidad determinístico sobre lo extraído: unidad
//      reconocible (normalizeUnit, ya usada en todo el módulo BIM), cantidad
//      numérica finita, descripción no vacía.
//
// Mismo patrón de import perezoso de `pdf-parse` que lib/invoice-extraction.ts
// (su dependencia pdfjs-dist rompe en Vercel si se importa siempre) y mismo
// proveedor (DeepSeek) que el resto del módulo BIM — no se suma un segundo
// proveedor de IA solo para esto.
import { normalizeUnit } from "@/lib/bim/matching";
import type { ComputoConfidenceSummary } from "@/lib/types";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEEPSEEK_MODEL = "deepseek-v4-flash";
const MIN_TEXT_LENGTH = 40;

export class ComputoPdfConfigError extends Error {}

export interface ExtractedComputoRow {
  description: string;
  quantityRaw: number | null;
  unitRaw: string | null;
  confidence: number | null;
}

export interface ComputoPdfExtractionResult {
  rows: ExtractedComputoRow[];
  confidenceSummary: ComputoConfidenceSummary;
  vicious: boolean; // true si el gate decide que no hay que confiar en esto
}

const EXTRACTION_PROMPT = `Sos un asistente que lee el texto extraído de un cómputo métrico o planilla de presupuesto referencial (PDF con texto real, ya extraído — puede venir con columnas desalineadas por la extracción).

Identificá cada línea que represente un ítem de obra con cantidad: descripción, cantidad y unidad. Ignorá encabezados, totales, subtotales y notas.

Para cada fila devolvé tu propia confianza (0 a 1) de que la leíste correctamente. Si el texto no forma una tabla clara y tuviste que adivinar estructura, marcá "tabla_clara": false.

Respondé EXCLUSIVAMENTE un objeto JSON:
{"tabla_clara": boolean, "filas": [{"descripcion": string, "cantidad": number|null, "unidad": string|null, "confianza": number}]}`;

async function callDeepSeekExtraction(text: string): Promise<{ tablaClara: boolean; rows: ExtractedComputoRow[] } | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new ComputoPdfConfigError(
      "DEEPSEEK_API_KEY no está configurada. La extracción de PDF la requiere server-side; no existe un fallback silencioso."
    );
  }

  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: EXTRACTION_PROMPT },
        { role: "user", content: `Texto del PDF:\n\n${text.slice(0, 12000)}` },
      ],
    }),
  });
  if (!response.ok) return null;

  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  const p = parsed as { tabla_clara?: unknown; filas?: unknown };
  if (typeof p.tabla_clara !== "boolean" || !Array.isArray(p.filas)) return null;

  const rows: ExtractedComputoRow[] = p.filas
    .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null)
    .map((f) => ({
      description: typeof f.descripcion === "string" ? f.descripcion : "",
      quantityRaw: typeof f.cantidad === "number" && Number.isFinite(f.cantidad) ? f.cantidad : null,
      unitRaw: typeof f.unidad === "string" ? f.unidad : null,
      confidence: typeof f.confianza === "number" && Number.isFinite(f.confianza) ? Math.min(1, Math.max(0, f.confianza)) : null,
    }))
    .filter((r) => r.description.trim() !== "");

  return { tablaClara: p.tabla_clara, rows };
}

function sanityIssuesFor(row: ExtractedComputoRow): string[] {
  const issues: string[] = [];
  if (!row.description.trim()) issues.push("descripción vacía");
  if (row.quantityRaw == null || !Number.isFinite(row.quantityRaw) || row.quantityRaw <= 0) issues.push("cantidad inválida");
  if (!normalizeUnit(row.unitRaw)) issues.push(`unidad no reconocida: "${row.unitRaw ?? ""}"`);
  return issues;
}

export async function extractComputoFromPdf(bytes: Buffer): Promise<ComputoPdfExtractionResult> {
  // --- 1. Señal estructural: ¿hay texto real? -------------------------------
  let text: string;
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: bytes });
    const result = await parser.getText();
    await parser.destroy();
    text = result.text.trim();
  } catch {
    return {
      rows: [],
      confidenceSummary: { textLayerOk: false, llmConfidence: null, sanityIssues: ["no se pudo abrir el PDF"] },
      vicious: true,
    };
  }

  if (text.length < MIN_TEXT_LENGTH) {
    return {
      rows: [],
      confidenceSummary: {
        textLayerOk: false,
        llmConfidence: null,
        sanityIssues: ["el PDF no tiene texto extraíble — parece un escaneo/foto"],
      },
      vicious: true,
    };
  }

  // --- 2. Confianza auto-reportada por DeepSeek -----------------------------
  const extraction = await callDeepSeekExtraction(text);
  if (!extraction || extraction.rows.length === 0) {
    return {
      rows: [],
      confidenceSummary: { textLayerOk: true, llmConfidence: null, sanityIssues: ["no se identificaron filas de cómputo"] },
      vicious: true,
    };
  }

  // --- 3. Chequeo de sanidad determinístico por fila ------------------------
  const allIssues: string[] = [];
  for (const row of extraction.rows) {
    const issues = sanityIssuesFor(row);
    if (issues.length > 0) allIssues.push(`"${row.description.slice(0, 40)}": ${issues.join(", ")}`);
  }

  const avgConfidence =
    extraction.rows.reduce((s, r) => s + (r.confidence ?? 0), 0) / extraction.rows.length || null;
  const suspiciousRatio = allIssues.length / extraction.rows.length;

  // Vicioso si: la IA misma dijo que no encontró una tabla clara, o más de un
  // tercio de las filas tienen problemas de sanidad, o la confianza promedio
  // es baja. Cualquiera de las tres alcanza — preferimos falsos positivos
  // (pedirle al humano que revise de más) a un falso negativo silencioso.
  const vicious = !extraction.tablaClara || suspiciousRatio > 0.33 || (avgConfidence != null && avgConfidence < 0.5);

  return {
    rows: extraction.rows,
    confidenceSummary: { textLayerOk: true, llmConfidence: avgConfidence, sanityIssues: allIssues },
    vicious,
  };
}
