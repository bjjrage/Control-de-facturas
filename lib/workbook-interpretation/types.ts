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
  subtotal: z.number().finite().nullable().optional(),
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

export type WorkbookDefinedName = {
  name: string;
  ref: string;
  sheet: string | null;
  value: string | number | boolean | null;
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
export const ImportColumnRoleSchema = z.enum(["code", "description", "unit", "quantity", "unitPrice", "subtotal", "previousQuantity", "currentQuantity", "cumulativeQuantity", "previousAmount", "currentAmount", "cumulativeAmount", "percentage", "date", "name", "value", "ignore"]);
export const ImportColumnMappingSchema = z.object({ column: z.string().min(1), role: ImportColumnRoleSchema, confidence: z.number().min(0).max(1), notes: z.string() });

// Scalars the model locates by cell (certificate number, period, declared
// totals). The model says where they are and what they mean; the extractor
// verifies the value against the cell before anything uses it.
export const ImportKeyValueKeySchema = z.enum(["certificateNumber", "periodStart", "periodEnd", "contractAmount", "declaredTotal", "declaredPreviousAmount", "declaredCurrentAmount", "declaredCumulativeAmount", "unitCount"]);
export type ImportKeyValueKey = z.infer<typeof ImportKeyValueKeySchema>;
export const ImportKeyValueSchema = z.object({ key: ImportKeyValueKeySchema, cell: z.string().min(1), value: z.union([z.string(), z.number()]), notes: z.string() });
export type ImportKeyValue = z.infer<typeof ImportKeyValueSchema>;

// What quantity scale a block represents (e.g. a 1-house prototype vs. the
// 37-house contract). Declared by the model, verified arithmetically later.
export const ImportScaleSchema = z.object({
  basis: z.enum(["PROTOTYPE_UNIT", "CONTRACT_TOTAL", "PERIOD", "NOT_APPLICABLE", "UNKNOWN"]),
  units: z.number().positive().nullable(),
  evidence: z.string(),
});
export type ImportScale = z.infer<typeof ImportScaleSchema>;

// STAFF blocks are a plain two-column roster (name, role) with occasional
// section-header rows (a lone label, no role) mixed in — the model marks
// which rows are real people so the extractor never turns a section title
// into a person.
export const ImportStaffRowSchema = z.object({ row: z.number().int().positive(), name: z.string().min(1), role: z.string().min(1) });
export type ImportStaffRow = z.infer<typeof ImportStaffRowSchema>;

// A schedule sheet is usually a small matrix: named rows (one per series)
// across month columns, not a row-per-record table. The model identifies
// each row's role explicitly. EXECUTED_* rows are evidence only — the ERP
// derives actual progress from its own certificates and never imports a
// spreadsheet's copy of it. Multiple contract versions (Original, Adenda 1)
// can coexist; planVersion groups the rows that belong together.
export const ImportScheduleSeriesRoleSchema = z.enum(["PLANNED_MONTHLY", "PLANNED_CUMULATIVE", "EXECUTED_MONTHLY", "EXECUTED_CUMULATIVE", "OTHER"]);
export const ImportScheduleSeriesSchema = z.object({
  row: z.number().int().positive(),
  label: z.string().min(1),
  role: ImportScheduleSeriesRoleSchema,
  planVersion: z.string().min(1),
  monthColumns: z.array(z.object({ column: z.string().min(1), monthIndex: z.number().int().positive() })),
});
export type ImportScheduleSeries = z.infer<typeof ImportScheduleSeriesSchema>;

// A "días no trabajados" sheet is a calendar grid: one row per calendar
// month, one column per day-of-month. The year is often a merged cell that
// only shows on the row it starts (carry it forward); the month is Spanish
// text ("6. Julio") the model turns into a real month number. The model
// never reports the day codes themselves — the extractor reads each
// (row, dayColumn) cell directly and keeps only B/LL/HH/O.
export const ImportWeatherRowSchema = z.object({
  row: z.number().int().positive(),
  year: z.number().int().min(1900).max(2200),
  month: z.number().int().min(1).max(12),
  dayColumns: z.array(z.object({ column: z.string().min(1), day: z.number().int().min(1).max(31) })),
});
export type ImportWeatherRow = z.infer<typeof ImportWeatherRowSchema>;

export const ImportBlockSchema = z.object({
  id: z.string().min(1), sheet: z.string().min(1), sourceRange: z.string().min(1), target: ImportTargetSchema, confidence: z.number().min(0).max(1), needsReview: z.boolean(),
  headerRowStart: z.number().int().positive(), headerRowEnd: z.number().int().positive(), dataRowStart: z.number().int().positive(), dataRowEnd: z.number().int().positive(), columnMappings: z.array(ImportColumnMappingSchema),
  repeatedHeaderRows: z.array(z.number().int().positive()), subtotalRows: z.array(z.number().int().positive()), footerRows: z.array(z.number().int().positive()), excludedRows: z.array(z.object({ row: z.number().int().positive(), reason: z.string().min(1) })), notes: z.string(),
  label: z.string().optional(),
  // false when the model identifies the block as belonging to a different
  // project (sheets pasted from another obra). Such blocks are shown, never imported.
  mainProject: z.boolean().optional(),
  scale: ImportScaleSchema.optional(),
  keyValues: z.array(ImportKeyValueSchema).optional(),
  staffRows: z.array(ImportStaffRowSchema).optional(),
  scheduleSeries: z.array(ImportScheduleSeriesSchema).optional(),
  weatherRows: z.array(ImportWeatherRowSchema).optional(),
  warnings: z.array(z.string()).optional(),
});
export type ImportBlock = z.infer<typeof ImportBlockSchema>;

export const ImportRelationshipTypeSchema = z.enum(["SAME_ITEMS", "CONTRACT_SCALE", "SUMMARIZES", "HISTORICAL_SERIES", "SUPPORTS"]);
export const ImportRelationshipSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  type: ImportRelationshipTypeSchema,
  factor: z.number().positive().nullable(),
  confidence: z.number().min(0).max(1),
  evidence: z.string(),
});
export type ImportRelationship = z.infer<typeof ImportRelationshipSchema>;

export const ImportPlanSchema = z.object({ workbookType: z.string().min(1), overallConfidence: z.number().min(0).max(1), blocks: z.array(ImportBlockSchema), relationships: z.array(ImportRelationshipSchema).optional(), unresolvedRegions: z.array(z.object({ sheet: z.string().min(1), range: z.string().min(1), reason: z.string().min(1) })), warnings: z.array(z.string()) });
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
  // Both are filled locally (derived from the plan / copied from cells);
  // the model no longer has to echo them.
  detectedSections: z.array(DetectedSectionSchema).default([]),
  importPlan: ImportPlanSchema,
  budgetItems: z.array(WorkbookBudgetItemSchema).default([]),
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
  definedNames?: WorkbookDefinedName[];
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
