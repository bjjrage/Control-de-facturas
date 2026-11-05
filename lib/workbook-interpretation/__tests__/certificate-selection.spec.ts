import { describe, expect, it } from "vitest";
import { certificateDecisionMissing } from "../certificate-selection";

describe("explicit certificate import decision", () => {
  it.each(["SAFE_TO_APPLY", "APPLY_WITH_WARNINGS", "DETECTED_NOT_APPLIED"])("does not silently skip a detected certificate: %s", status => {
    expect(certificateDecisionMissing(status, false, false)).toBe(true);
    expect(certificateDecisionMissing(status, false, true)).toBe(false);
  });
  it("accepts an explicit import selection, including a reviewed certificate", () => {
    expect(certificateDecisionMissing("APPLY_WITH_WARNINGS", true, false)).toBe(false);
  });
  it("does not require a certificate choice for an APU/budget workbook without a certificate", () => {
    expect(certificateDecisionMissing("NOT_DETECTED", false, false)).toBe(false);
    expect(certificateDecisionMissing(undefined, false, false)).toBe(false);
  });
});
