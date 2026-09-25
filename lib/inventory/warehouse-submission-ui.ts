import type {
  WarehouseSubmissionLineState,
  WarehouseSubmissionStatus,
} from "./types";

export function canConfirmWarehouseSubmission(input: {
  status: WarehouseSubmissionStatus;
  uploadIncomplete: boolean;
  lineStates: readonly WarehouseSubmissionLineState[];
}): boolean {
  const confirmableStatus = input.status === "READY" || input.status === "NEEDS_REVIEW";
  const hasAcceptedLine = input.lineStates.some((state) => state === "CONFIRMED");
  const hasProposedLine = input.lineStates.some((state) => state === "PROPOSED");

  return confirmableStatus && !input.uploadIncomplete && hasAcceptedLine && !hasProposedLine;
}
