import { expect, it, vi } from "vitest";
import { sourceFunctions } from "./support/source-functions";
function handler(open: boolean) {
  const setOpen = vi.fn(), pointerType = { current: null };
  const { handleKeyDown } = sourceFunctions("components/ui/info-tooltip.tsx", ["handleKeyDown"], { setOpen, pointerType, open });
  return { setOpen, handleKeyDown };
}
it("opens help with Enter even when focus came from opening a dialog with the pointer", () => {
  const { setOpen, handleKeyDown } = handler(false);
  handleKeyDown({ key: "Enter", preventDefault: vi.fn(), stopPropagation: vi.fn() });
  expect(setOpen).toHaveBeenCalledWith(true);
});
it("Escape consumes the open help before the containing dialog", () => {
  const { setOpen, handleKeyDown } = handler(true);
  const event = { key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() };
  handleKeyDown(event);
  expect(setOpen).toHaveBeenCalledWith(false);
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(event.stopPropagation).toHaveBeenCalledOnce();
});
it("Escape remains available to the containing dialog when help is already closed", () => {
  const { handleKeyDown } = handler(false);
  const event = { key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() };
  handleKeyDown(event);
  expect(event.preventDefault).not.toHaveBeenCalled();
});
