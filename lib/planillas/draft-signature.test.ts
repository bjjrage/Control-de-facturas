import { it, expect } from "vitest";
import { draftSignature, meaningfulDraftRows } from "./draft-signature";
import { COMPUTO_PRESUPUESTO_COLUMNS as columns } from "./adapters/computo-presupuesto";
it("does not treat generated subtotal on a spare row as a new budget item", () => {
  const row = { _rowId: "new:spare", code: null, description: null, quantity: null, unit_price: null, subtotal: 0, _formulas: { subtotal: "=D2*E2" } };
  expect(meaningfulDraftRows([row], columns)).toEqual([]);
  expect(draftSignature([row], columns)).toBe(draftSignature([], columns));
  expect(meaningfulDraftRows([{ ...row, quantity: 0 }], columns)).toHaveLength(1);
});
it("retains editable formulas, deletions and stable identities in the change signature", () => {
  const row = { _rowId: "existing", code: "A", quantity: 4, _formulas: { quantity: "=2+2" } };
  expect(draftSignature([row], columns)).not.toBe(draftSignature([{ ...row, _formulas: {} }], columns));
  expect(draftSignature([row], columns)).not.toBe(draftSignature([{ ...row, _deleted: true }], columns));
});
it("does not save a phantom edit when the engine materializes an empty style", () => {
  const row = { _rowId: "existing", code: "01", quantity: 6 };
  expect(draftSignature([row], columns)).toBe(draftSignature([{ ...row, _style: {}, _cellStyles: { quantity: {} } }], columns));
});
