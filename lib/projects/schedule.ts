const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDay(value: string): boolean {
  if (!ISO_DAY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateScheduleDates(startDate: string | null, endDate: string | null): string | null {
  if (startDate && !isValidIsoDay(startDate)) return "La fecha de inicio no es válida.";
  if (endDate && !isValidIsoDay(endDate)) return "La fecha de fin no es válida.";
  if (Boolean(startDate) !== Boolean(endDate)) return "Completá inicio y fin, o dejá ambas fechas vacías.";
  if (startDate && endDate && endDate < startDate) return "La fecha de fin no puede ser anterior al inicio.";
  return null;
}

export function inclusiveScheduleDuration(startDate: string, endDate: string): number | null {
  if (validateScheduleDates(startDate, endDate)) return null;
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
}

/** Schedule only leaf budget lines; parent rubros summarize their children in the Gantt. */
export function scheduleLeafBudgetItems<T extends { code: string }>(items: readonly T[]): T[] {
  const parentCodes = new Set<string>();
  for (const item of items) {
    const separator = item.code.lastIndexOf(".");
    if (separator > 0) parentCodes.add(item.code.slice(0, separator));
  }
  return items.filter((item) => !parentCodes.has(item.code));
}
