export interface ClimateSelectionResult {
  saved: string[];
  failed: { date: string; error: string }[];
}

export function selectClimateDate(selected: string[], date: string, additive: boolean): string[] {
  if (!additive) return [date];
  return selected.includes(date) ? selected.filter(value => value !== date) : [...selected, date].sort();
}

/** Client orchestration only: each existing server action retains its own checks.
 * Next dispatches actions sequentially. This is not an atomic batch. */
export async function saveClimateSelection(
  dates: string[],
  save: (date: string) => Promise<{ error: string | null }>,
): Promise<ClimateSelectionResult> {
  const result: ClimateSelectionResult = { saved: [], failed: [] };
  for (const date of [...new Set(dates)].sort()) {
    try {
      const response = await save(date);
      if (response.error) result.failed.push({ date, error: response.error });
      else result.saved.push(date);
    } catch {
      result.failed.push({ date, error: "No se pudo guardar. Reintentá este día." });
    }
  }
  return result;
}
