import type { WeatherCode } from "@/lib/types";

export interface ClimateSelectionResult {
  saved: string[];
  failed: { date: string; error: string }[];
  error?: string;
}

export interface ClimateDraftEntry { date: string; code: WeatherCode }
export type ClimateDraft = Record<string, WeatherCode>;

export function stageClimateDraft(draft: ClimateDraft, dates: string[], code: WeatherCode): ClimateDraft {
  const next = { ...draft };
  for (const date of dates) next[date] = code;
  return next;
}

/** Server orchestration: one browser request, bounded independent day writes.
 * Existing canonical actions remain responsible for auth and persistence. */
export async function saveClimateDraftEntries(
  entries: ClimateDraftEntry[],
  save: (entry: ClimateDraftEntry) => Promise<{ error: string | null }>,
): Promise<ClimateSelectionResult> {
  const result: ClimateSelectionResult = { saved: [], failed: [] };
  for (let offset = 0; offset < entries.length; offset += 3) {
    const outcomes = await Promise.all(entries.slice(offset, offset + 3).map(async entry => {
      try {
        const response = await save(entry);
        return { date: entry.date, error: response.error };
      } catch {
        return { date: entry.date, error: "No se pudo guardar. Revisá este día y reintentá." };
      }
    }));
    for (const outcome of outcomes) {
      if (outcome.error) result.failed.push({ date: outcome.date, error: outcome.error });
      else result.saved.push(outcome.date);
    }
  }
  return result;
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
