import { z } from "zod";

// ---------------------------------------------------------------------------
// Importador de APU "tal cual": se lee la planilla entera y Luna solo
// CLASIFICA (qué es cada columna y qué es cada fila). Los valores nunca los
// devuelve el modelo: los lee el extractor directo de las celdas.
// ---------------------------------------------------------------------------

export const APU_INPUT_TYPES = ["MATERIAL", "MANO_DE_OBRA", "EQUIPO", "SUBCONTRATO"] as const;
export type ApuInputType = (typeof APU_INPUT_TYPES)[number];

export const APU_ROW_KINDS = ["RECIPE_HEADER", "INPUT", "SECTION", "TOTAL", "OTHER"] as const;
export type ApuRowKind = (typeof APU_ROW_KINDS)[number];

const columnLetter = z.string().regex(/^[A-Z]{1,3}$/).nullable();

export const ApuSheetLayoutSchema = z.object({
  isApu: z.boolean(),
  confidence: z.number().min(0).max(1),
  columns: z.object({
    recipeCode: columnLetter,
    recipeName: columnLetter,
    inputType: columnLetter,
    description: columnLetter,
    unit: columnLetter,
    quantity: columnLetter,
    unitPrice: columnLetter,
    wastePct: columnLetter,
    lineTotal: columnLetter,
    recipeTotal: columnLetter,
  }),
  notes: z.string(),
  questions: z.array(z.string()),
});
export type ApuSheetLayout = z.infer<typeof ApuSheetLayoutSchema>;

export const ApuRowLabelSchema = z.object({
  row: z.number().int().positive(),
  kind: z.enum(APU_ROW_KINDS),
  inputType: z.enum(APU_INPUT_TYPES).nullable(),
});
export type ApuRowLabel = z.infer<typeof ApuRowLabelSchema>;

export const ApuRowLabelsSchema = z.object({ rows: z.array(ApuRowLabelSchema), questions: z.array(z.string()) });

export interface ApuPreviewLine {
  row: number;
  tipo: ApuInputType;
  descripcion: string;
  unidad: string | null;
  cantidad: number;
  precio: number | null;
  desperdicioPct: number;
}

export interface ApuPreviewRecipe {
  sheet: string;
  headerRow: number | null;
  code: string | null;
  name: string;
  unit: string | null;
  lines: ApuPreviewLine[];
  declaredTotal: number | null;
  computedTotal: number | null;
  totalMismatch: boolean;
}

export interface ApuUnresolvedRow {
  sheet: string;
  row: number;
  reason: string;
  text: string;
}

export interface ApuImportPreview {
  fileName: string;
  recipes: ApuPreviewRecipe[];
  unresolved: ApuUnresolvedRow[];
  questions: string[];
  warnings: string[];
  stats: { sheets: number; apuSheets: number; rows: number; recipes: number; lines: number };
}
