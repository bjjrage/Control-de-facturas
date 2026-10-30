"use client";

import type { PlanillaColumn, PlanillaRow } from "@/lib/planillas/types";

export type PlanillaGridRow = PlanillaRow;
export type PlanillaGridProps = {
  columns: PlanillaColumn[];
  initialRows: PlanillaGridRow[];
  onChange: (rows: PlanillaGridRow[]) => void;
  onSelectRow?: (id: string | null) => void;
  flushPendingRef?: { current: (() => Promise<void>) | null };
  readOnly?: boolean;
  fixedRows?: boolean;
};

// Keep the public grid interface while using the Apache-2.0 core already
// installed for workbook editing. No evaluation/commercial engine is loaded.
export { UniverPlanillaGrid as PlanillaGrid } from "./UniverPlanillaGrid";
