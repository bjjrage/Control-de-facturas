import type { WorkbookRepresentation, WorkbookSheetRepresentation } from "@/lib/workbook-interpretation/types";
import {
  InvalidModelResponseError,
  ModelUnavailableError,
  WorkbookInterpreterConfigurationError,
  WorkbookInterpreterRateLimitError,
  WorkbookInterpreterTimeoutError,
} from "@/lib/workbook-interpretation/interpreter";
import { extractApuRecipes, indexRows } from "./extract";
import {
  APU_INPUT_TYPES,
  APU_ROW_KINDS,
  ApuRowLabelsSchema,
  ApuSheetLayoutSchema,
  type ApuImportPreview,
  type ApuRowLabel,
  type ApuSheetLayout,
} from "./types";

const DEFAULT_MODEL = "gpt-6-luna";
const DEADLINE_MS = 270_000;
const CHUNK_ROWS = 110;
const MAX_ROWS = 6000;
const CONCURRENCY = 3;

const model = () => process.env.APU_IMPORT_MODEL ?? process.env.WORKBOOK_INTERPRETATION_MODEL ?? DEFAULT_MODEL;

const NULLABLE_LETTER = { anyOf: [{ type: "string" }, { type: "null" }] };
const LAYOUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["isApu", "confidence", "columns", "notes", "questions"],
  properties: {
    isApu: { type: "boolean" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    columns: {
      type: "object",
      additionalProperties: false,
      required: ["recipeCode", "recipeName", "inputType", "description", "unit", "quantity", "unitPrice", "wastePct", "lineTotal", "recipeTotal"],
      properties: {
        recipeCode: NULLABLE_LETTER,
        recipeName: NULLABLE_LETTER,
        inputType: NULLABLE_LETTER,
        description: NULLABLE_LETTER,
        unit: NULLABLE_LETTER,
        quantity: NULLABLE_LETTER,
        unitPrice: NULLABLE_LETTER,
        wastePct: NULLABLE_LETTER,
        lineTotal: NULLABLE_LETTER,
        recipeTotal: NULLABLE_LETTER,
      },
    },
    notes: { type: "string" },
    questions: { type: "array", items: { type: "string" } },
  },
};

const ROWS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rows", "questions"],
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["row", "kind", "inputType"],
        properties: {
          row: { type: "integer", minimum: 1 },
          kind: { type: "string", enum: [...APU_ROW_KINDS] },
          inputType: { anyOf: [{ type: "string", enum: [...APU_INPUT_TYPES] }, { type: "null" }] },
        },
      },
    },
    questions: { type: "array", items: { type: "string" } },
  },
};

const CONTEXT = `Sos parte de un ERP de construcción de Paraguay. Te paso filas de una planilla de Excel de una constructora. Puede contener APU (análisis de precios unitarios): la "receta" de cada partida (ej. "Revoque interior", unidad m²), con los insumos que lleva UNA unidad de esa partida: materiales, mano de obra, equipos y subcontratos, con su cantidad, unidad y precio.
Cada planilla tiene su propio formato: puede traer una fila por insumo con la partida repetida en una columna, o bloques (una fila de encabezado de partida seguida de sus insumos, con títulos de sección como "Materiales" o "Mano de obra"), con o sin precios y totales.
NUNCA devolvás valores, cantidades ni textos de la planilla: solo clasificá. Las filas se identifican por su número (R12 = fila 12) y las celdas como A=..., B=....`;

const LAYOUT_INSTRUCTIONS = `${CONTEXT}

Tarea: determiná el diseño de columnas de esta hoja. Devolvé la LETRA de columna (A, B, C…) de cada campo, o null si la hoja no lo tiene:
- recipeCode: código de la partida (si existe).
- recipeName: SOLO si el nombre de la partida se repite en una columna en cada fila de insumo (formato de una fila por insumo). Si la partida aparece una sola vez en una fila de encabezado, dejá null.
- inputType: columna que dice si el insumo es material / mano de obra / equipo / subcontrato (si existe).
- description: descripción del insumo (o de la partida en la fila de encabezado).
- unit: unidad. quantity: cantidad (o rendimiento) POR UNIDAD de la partida. unitPrice: precio o costo unitario. wastePct: % de desperdicio. lineTotal: total de la línea. recipeTotal: costo total/unitario de la partida (suele estar en la fila de encabezado o subtotal).
- isApu=false si la hoja no contiene recetas de APU (por ejemplo un presupuesto simple, un cronograma o una portada).
- questions: dudas concretas que un humano debería resolver (por ejemplo si la cantidad está en horas o en jornales). Vacío si no hay dudas.`;

const ROWS_INSTRUCTIONS = `${CONTEXT}

Tarea: clasificá CADA fila que te paso (no te saltees ninguna) según el diseño de columnas dado:
- RECIPE_HEADER: fila que abre una partida/receta (nombre de la partida, a veces con su código, unidad y costo total).
- INPUT: fila de un insumo de la receta (material, mano de obra, equipo o subcontrato) con cantidad.
- SECTION: título que agrupa insumos (ej. "MATERIALES", "MANO DE OBRA", "EQUIPOS", "SUBCONTRATOS").
- TOTAL: subtotal, total o resumen (costo directo, gastos, utilidad, IVA, etc.).
- OTHER: encabezados de columnas, títulos de la planilla, notas, filas que no son de la receta.
inputType: en INPUT y SECTION, poné a qué tipo pertenece (MATERIAL, MANO_DE_OBRA, EQUIPO, SUBCONTRATO) si se puede deducir de la fila, de su columna de tipo o del título de sección; si no se puede, null. En RECIPE_HEADER/TOTAL/OTHER va null.
Un insumo cuyo tipo no está claro NO se inventa: inputType null. Si algo te genera duda real, agregalo en questions.`;

function serializeRow(sheet: ReturnType<typeof indexRows>, row: number): string {
  const cells = sheet.get(row);
  if (!cells) return `R${row}:`;
  const parts = [...cells.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([col, cell]) => {
      const value = (cell.formatted ?? (cell.raw == null ? "" : String(cell.raw))).trim().slice(0, 70);
      let letters = "";
      for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
      return value ? `${letters}=${value}` : "";
    })
    .filter(Boolean);
  return `R${row}: ${parts.join(" ; ")}`;
}

interface ResponsesPayload {
  status?: string;
  output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>;
  error?: { message?: string };
}

async function callModel(instructions: string, input: string, schemaName: string, schema: unknown, deadline: number): Promise<unknown> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new ModelUnavailableError("El análisis con Luna no está configurado (falta OPENAI_API_KEY).");
  const remaining = deadline - Date.now();
  if (remaining <= 1_000) throw new WorkbookInterpreterTimeoutError("El análisis tardó demasiado. Reintentá.");
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model(),
        instructions,
        input,
        store: false,
        reasoning: { effort: "low" },
        max_output_tokens: 16_000,
        text: { format: { type: "json_schema", name: schemaName, schema, strict: true } },
      }),
      signal: AbortSignal.timeout(remaining),
    });
  } catch (cause) {
    if (cause instanceof Error && (cause.name === "TimeoutError" || /timeout/i.test(cause.message))) {
      throw new WorkbookInterpreterTimeoutError("El análisis tardó demasiado. Reintentá.");
    }
    throw new ModelUnavailableError("El servicio de análisis no está disponible temporalmente.");
  }
  if (!response.ok) {
    if (response.status === 429) throw new WorkbookInterpreterRateLimitError("Límite temporal del servicio. Reintentá en unos segundos.");
    if (response.status === 401 || response.status === 403) throw new WorkbookInterpreterConfigurationError("La configuración del servicio de análisis no es válida.");
    const body = (await response.json().catch(() => ({}))) as ResponsesPayload;
    console.error("apu_import_openai_error", { status: response.status, message: String(body.error?.message ?? "").slice(0, 300) });
    throw new ModelUnavailableError("El servicio de análisis no está disponible temporalmente.");
  }
  const payload = (await response.json()) as ResponsesPayload;
  if (payload.status === "incomplete") throw new InvalidModelResponseError("La respuesta de Luna quedó incompleta. Probá con una planilla más chica.");
  for (const item of payload.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type === "refusal") throw new InvalidModelResponseError("Luna rechazó analizar la planilla.");
      if (part.type === "output_text" && typeof part.text === "string") {
        try {
          return JSON.parse(part.text);
        } catch {
          throw new InvalidModelResponseError("Luna devolvió una respuesta inválida.");
        }
      }
    }
  }
  throw new InvalidModelResponseError("Luna no devolvió contenido.");
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    })
  );
  return results;
}

/** Muestra para el diseño: el comienzo de la hoja más filas repartidas hasta el final. */
function layoutSample(rows: number[]): number[] {
  const head = rows.slice(0, 100);
  const rest = rows.slice(100);
  if (rest.length === 0) return head;
  const step = Math.max(1, Math.floor(rest.length / 50));
  return [...head, ...rest.filter((_, i) => i % step === 0).slice(0, 50)];
}

export async function analyzeApuWorkbook(workbook: WorkbookRepresentation): Promise<ApuImportPreview> {
  const deadline = Date.now() + DEADLINE_MS;
  const preview: ApuImportPreview = {
    fileName: workbook.fileName,
    recipes: [],
    unresolved: [],
    questions: [],
    warnings: [...workbook.warnings],
    stats: { sheets: workbook.sheets.length, apuSheets: 0, rows: 0, recipes: 0, lines: 0 },
  };

  const totalRows = workbook.sheets.reduce((s, sh) => s + new Set(sh.cells.map((c) => c.row)).size, 0);
  if (totalRows > MAX_ROWS) {
    throw new InvalidModelResponseError(`La planilla tiene ${totalRows} filas con datos (el máximo por importación es ${MAX_ROWS}). Dividila por hojas o por rubros.`);
  }

  for (const sheet of workbook.sheets as WorkbookSheetRepresentation[]) {
    const rowIndex = indexRows(sheet);
    const rowNumbers = [...rowIndex.keys()].sort((a, b) => a - b);
    if (rowNumbers.length === 0) continue;

    const layoutRaw = await callModel(
      LAYOUT_INSTRUCTIONS,
      `Hoja "${sheet.sheetName}"${sheet.hidden ? " (oculta)" : ""}. Filas:\n${layoutSample(rowNumbers).map((r) => serializeRow(rowIndex, r)).join("\n")}`,
      "apu_layout",
      LAYOUT_SCHEMA,
      deadline
    );
    const layoutParsed = ApuSheetLayoutSchema.safeParse(layoutRaw);
    if (!layoutParsed.success) throw new InvalidModelResponseError("Luna devolvió un diseño de columnas inválido.");
    const layout: ApuSheetLayout = layoutParsed.data;
    preview.questions.push(...layout.questions.map((q) => `[${sheet.sheetName}] ${q}`));

    if (!layout.isApu || layout.confidence < 0.3 || !layout.columns.description || !layout.columns.quantity) {
      preview.warnings.push(`La hoja "${sheet.sheetName}" no parece contener recetas de APU y se omitió (${layout.notes || "sin detalle"}).`);
      continue;
    }
    preview.stats.apuSheets++;

    const chunks: number[][] = [];
    for (let i = 0; i < rowNumbers.length; i += CHUNK_ROWS) chunks.push(rowNumbers.slice(i, i + CHUNK_ROWS));
    const layoutText = JSON.stringify(layout.columns);
    const labelChunks = await mapLimit(chunks, CONCURRENCY, async (chunk) => {
      const raw = await callModel(
        ROWS_INSTRUCTIONS,
        `Hoja "${sheet.sheetName}". Diseño de columnas: ${layoutText}\nClasificá estas ${chunk.length} filas:\n${chunk.map((r) => serializeRow(rowIndex, r)).join("\n")}`,
        "apu_rows",
        ROWS_SCHEMA,
        deadline
      );
      const parsed = ApuRowLabelsSchema.safeParse(raw);
      if (!parsed.success) throw new InvalidModelResponseError("Luna devolvió una clasificación de filas inválida.");
      const allowed = new Set(chunk);
      return { rows: parsed.data.rows.filter((r) => allowed.has(r.row)), questions: parsed.data.questions };
    });
    const labels: ApuRowLabel[] = labelChunks.flatMap((c) => c.rows);
    preview.questions.push(...labelChunks.flatMap((c) => c.questions).map((q) => `[${sheet.sheetName}] ${q}`));

    const extracted = extractApuRecipes(sheet, layout, labels);
    preview.recipes.push(...extracted.recipes);
    preview.unresolved.push(...extracted.unresolved);
    preview.stats.rows += extracted.rowsRead;
  }

  preview.questions = [...new Set(preview.questions)].slice(0, 12);
  preview.stats.recipes = preview.recipes.length;
  preview.stats.lines = preview.recipes.reduce((s, r) => s + r.lines.length, 0);
  return preview;
}
