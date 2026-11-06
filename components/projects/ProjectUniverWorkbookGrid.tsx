"use client";

import { useMemo } from "react";
import { merge } from "@univerjs/presets";
import { UniverSheetsFilterPreset } from "@univerjs/preset-sheets-filter";
import { UniverSheetsSortPreset } from "@univerjs/preset-sheets-sort";
import { UniverSheetsFindReplacePreset } from "@univerjs/preset-sheets-find-replace";
import filterEsES from "@univerjs/preset-sheets-filter/locales/es-ES";
import sortEsES from "@univerjs/preset-sheets-sort/locales/es-ES";
import findEsES from "@univerjs/preset-sheets-find-replace/locales/es-ES";
import "@univerjs/preset-sheets-filter/lib/index.css";
import "@univerjs/preset-sheets-sort/lib/index.css";
import "@univerjs/preset-sheets-find-replace/lib/index.css";
import { UniverWorkbookGrid, type UniverWorkbookGridProps } from "@/components/certificates/CertificateWorkbookGrid";
import { normalizeWorkspaceNumbers } from "@/lib/projects/workspace-inputs";

/** Load only through a client-only dynamic boundary: the filter plugin uses
 * browser canvas APIs at module evaluation time. Certificates keep their
 * existing preset and do not acquire these workspace dependencies during SSR. */
export function ProjectUniverWorkbookGrid(props: UniverWorkbookGridProps) {
  const extraTools = useMemo<NonNullable<UniverWorkbookGridProps["extraTools"]>>(() => ({
    presets: [UniverSheetsFilterPreset(), UniverSheetsSortPreset(), UniverSheetsFindReplacePreset()],
    locale: merge({}, filterEsES, sortEsES, findEsES),
    configure: api => api.addEvent(api.Event.BeforeCommandExecute, event => {
      if (event.id !== "sheet.mutation.set-range-values") return;
      const params = event.params as { subUnitId?: string; cellValue?: unknown };
      if (params?.subUnitId) normalizeWorkspaceNumbers(params.subUnitId, params.cellValue);
    }),
  }), []);
  return <UniverWorkbookGrid {...props} extraTools={extraTools} />;
}
