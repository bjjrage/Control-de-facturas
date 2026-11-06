import { ICommandService, type Univer } from "@univerjs/core";
import { FormulaDataModel, SetFormulaDataMutation } from "@univerjs/engine-formula";
import { UpdateFormulaController } from "@univerjs/sheets-formula";
import type { FWorkbook } from "@univerjs/sheets/facade";

/** Browser plugin initialization may miss the first unit-added event. Rebuild
 * Univer's own reference model from the mounted document before structural
 * edits; no formulas, input values or calculations are translated here. */
export function initializeProjectFormulaReferences(univer: Univer, workbookId: string, workbook: FWorkbook): void {
  const injector = univer.__getInjector();
  injector.get(UpdateFormulaController);
  const model = injector.get(FormulaDataModel);
  const formulaData = { [workbookId]: Object.fromEntries(workbook.getSheets().map(sheet => [sheet.getSheetId(), model.getSheetFormulaData(workbookId, sheet.getSheetId())])) };
  injector.get(ICommandService).syncExecuteCommand(SetFormulaDataMutation.id, { formulaData }, { onlyLocal: true });
}
