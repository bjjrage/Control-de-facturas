export const CERTIFICATE_DECISION_REQUIRED = "El archivo contiene un certificado. Elegí importarlo o dejarlo pendiente antes de crear la obra.";

export function certificateDecisionMissing(status: string | undefined, include: boolean, omitConfirmed: boolean): boolean {
  return Boolean(status && status !== "NOT_DETECTED" && !include && !omitConfirmed);
}
