import { z } from "zod";

export const WORKBOOK_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const WORKBOOK_MAX_SHEETS = 40;
export const WORKBOOK_MAX_TOOL_RESPONSE_CHARS = 24_000;

export const ValueStatusSchema = z.enum(["FOUND", "UNCERTAIN", "NOT_FOUND"]);
export type ValueStatus = z.infer<typeof ValueStatusSchema>;

export const ProvenanceSchema = z.object({
  sheet: z.string().min(1),
  row: z.number().int().positive().optional(),
  column: z.number().int().positive().optional(),
  range: z.string().min(1).optional(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const DetectedFieldSchema = z.object({
  status: ValueStatusSchema,
  value: z.union([z.string(), z.number(), z.null()]),
  confidence: z.number().min(0).max(1),
  source: ProvenanceSchema.optional(),
});
export type DetectedField = z.infer<typeof DetectedFieldSchema>;

export const ProjectInterpretationSchema = z.object({
  name: DetectedFieldSchema,
  code: DetectedFieldSchema,
  client: DetectedFieldSchema,
  contractor: DetectedFieldSchema,
  location: DetectedFieldSchema,
  contractNumber: DetectedFieldSchema,
  startDate: DetectedFieldSchema,
  endDate: DetectedFieldSchema,
  totalAmount: DetectedFieldSchema,
});
export type ProjectInterpretation = z.infer<typeof ProjectInterpretationSchema>;

export const SectionTypeSchema = z.enum([
  "BUDGET",
  "MEASUREMENT",
  "PROGRESS",
  "CERTIFICATE",
  "SCHEDULE",
  "STAFF",
  "NON_WORKING_DAYS",
  "OTHER",
]);
export type SectionType = z.infer<typeof SectionTypeSchema>;

export const DetectedSectionSchema = z.object({
  type: SectionTypeSchema,
  title: z.string().min(1),
  sheet: z.string().min(1),
  range: z.string().min(1),
  rowCount: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
  columns: z.array(z.string()),
  sampleRows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
  warnings: z.array(z.string()),
});
export type DetectedSection = z.infer<typeof DetectedSectionSchema>;

export const UnknownSectionSchema = z.object({
  sheet: z.string().min(1),
  range: z.string().min(1),
  reason: z.string().min(1),
});
export type UnknownSection = z.infer<typeof UnknownSectionSchema>;

export const WorkbookBudgetItemSchema = z.object({
  code: z.string().min(1).nullable(),
  description: z.string().min(1),
  unit: z.string().min(1).nullable(),
  quantity: z.number().finite().nonnegative().nullable(),
  unitPrice: z.number().finite().nonnegative().nullable(),
  parentCode: z.string().min(1).nullable(),
  confidence: z.number().min(0).max(1),
  source: ProvenanceSchema,
});
export type WorkbookBudgetItem = z.infer<typeof WorkbookBudgetItemSchema>;

export type WorkbookCell = {
  address: string;
  row: number;
  column: number;
  raw: string | number | boolean | null;
  formatted: string | null;
  formula: string | null;
  type: string | null;
};

export type WorkbookBlock = {
  id: string;
  range: string;
  rowStart: number;
  rowEnd: number;
  columnStart: number;
  columnEnd: number;
  rowCount: number;
  title: string | null;
  headerRows: number[];
  candidateHeaders: string[];
  sampleRows: Array<Array<string | number | null>>;
  totalRowsWithData: number;
};

export type WorkbookSheetRepresentation = {
  sheetName: string;
  sheetIndex: number;
  usedRange: string;
  rowCount: number;
  columnCount: number;
  mergedCells: string[];
  allCellCount: number;
  serializedCellCount: number;
  cells: WorkbookCell[];
  blocks: WorkbookBlock[];
};

export const ImportTargetSchema = z.enum(["PROJECT_METADATA", "BUDGET", "SCHEDULE", "MEASUREMENT", "EXECUTION", "CERTIFICATE", "STAFF", "NON_WORKING_DAYS", "APU", "BOM", "OTHER"]);
export type ImportTarget = z.infer<typeof ImportTargetSchema>;
export const ImportColumnRoleSchema = z.enum(["code", "description", "unit", "quantity", "unitPrice", "subtotal", "previousQuantity", "currentQuantity", "cumulativeQuantity", "percentage", "date", "name", "value", "ignore"]);
export const ImportColumnMappingSchema = z.object({ column: z.string().min(1), role: ImportColumnRoleSchema, confidence: z.number().min(0).max(1), notes: z.string() });
export const ImportBlockSchema = z.object({
  id: z.string().min(1), sheet: z.string().min(1), sourceRange: z.string().min(1), target: ImportTargetSchema, confidence: z.number().min(0).max(1), needsReview: z.boolean(),
  headerRowStart: z.number().int().positive(), headerRowEnd: z.number().int().positive(), dataRowStart: z.number().int().positive(), dataRowEnd: z.number().int().positive(), columnMappings: z.array(ImportColumnMappingSchema),
  repeatedHeaderRows: z.array(z.number().int().positive()), subtotalRows: z.array(z.number().int().positive()), footerRows: z.array(z.number().int().positive()), excludedRows: z.array(z.object({ row: z.number().int().positive(), reason: z.string().min(1) })), notes: z.string(),
});
export type ImportBlock = z.infer<typeof ImportBlockSchema>;
export const ImportPlanSchema = z.object({ workbookType: z.string().min(1), overallConfidence: z.number().min(0).max(1), blocks: z.array(ImportBlockSchema), unresolvedRegions: z.array(z.object({ sheet: z.string().min(1), range: z.string().min(1), reason: z.string().min(1) })), warnings: z.array(z.string()) });
export type ImportPlan = z.infer<typeof ImportPlanSchema>;

export const ImportBlockCoverageSchema = z.object({
  blockId: z.string().min(1),
  sheet: z.string().min(1),
  sourceRange: z.string().min(1),
  sourceRows: z.number().int().nonnegative(),
  processedRows: z.number().int().nonnegative(),
  excludedRows: z.array(z.object({ row: z.number().int().positive(), reason: z.string().min(1) })),
  pendingRows: z.array(z.object({ row: z.number().int().positive(), reason: z.string().min(1) })),
  unmappedRows: z.array(z.number().int().positive()),
  warnings: z.array(z.string()),
});
export type ImportBlockCoverage = z.infer<typeof ImportBlockCoverageSchema>;

export const WorkbookInterpretationResultSchema = z.object({
  documentType: z.string().min(1),
  workbookSummary: z.object({
    summary: z.string().min(1),
    sheetCount: z.number().int().positive(),
  }),
  project: ProjectInterpretationSchema,
  detectedSections: z.array(DetectedSectionSchema),
  importPlan: ImportPlanSchema,
  budgetItems: z.array(WorkbookBudgetItemSchema),
  coverage: z.array(ImportBlockCoverageSchema).default([]),
  warnings: z.array(z.string()),
  unknownSections: z.array(UnknownSectionSchema),
  overallConfidence: z.number().min(0).max(1),
});
export type WorkbookInterpretationResult = z.infer<typeof WorkbookInterpretationResultSchema>;

export type WorkbookRepresentation = {
  fileName: string;
  workbookType: "EXCEL" | "CSV";
  sheets: WorkbookSheetRepresentation[];
  totalCells: number;
  serializedCellCount: number;
  warnings: string[];
};

export const PROJECT_FIELD_KEYS = [
  "name",
  "code",
  "client",
  "contractor",
  "location",
  "contractNumber",
  "startDate",
  "endDate",
  "totalAmount",
] as const;

export type ProjectFieldKey = (typeof PROJECT_FIELD_KEYS)[number];

export function notFoundField(): DetectedField {
  return { status: "NOT_FOUND", value: null, confidence: 1 };
}
