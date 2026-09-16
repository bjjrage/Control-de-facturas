import type { BudgetItem, ProjectWorkdayStatus, ClimateForecastMetrics } from "@/lib/types";

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function inclusiveDays(start: string, end: string) {
  const diff = Math.floor((parseDate(end).getTime() - parseDate(start).getTime()) / DAY_MS);
  return Math.max(0, diff + 1);
}

function dateRange(start: string, end: string) {
  const result: string[] = [];
  const current = parseDate(start);
  const last = parseDate(end);
  while (current <= last) {
    result.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return result;
}

/** Deriva métricas de impacto sin convertir la lluvia en un booleano.
 * Los días no registrados se consideran disponibles; sólo las clasificaciones
 * efectivas no trabajables reducen effective_available_days. */
export function deriveClimateForecastMetrics(input: {
  projectStartDate: string | null;
  asOfDate: string;
  workdays: Pick<ProjectWorkdayStatus, "work_date" | "classification" | "decision_status">[];
  budgetItems: Pick<BudgetItem, "start_date" | "end_date">[];
}): ClimateForecastMetrics {
  const calendarDays = input.projectStartDate && input.projectStartDate <= input.asOfDate
    ? inclusiveDays(input.projectStartDate, input.asOfDate)
    : 0;
  const effectiveWorkdays = input.workdays.filter((row) => row.decision_status === "CONFIRMED");
  const rainLost = effectiveWorkdays.filter((row) => row.classification === "NON_WORKABLE_RAIN").length;
  const rainEffectLost = effectiveWorkdays.filter((row) => row.classification === "NON_WORKABLE_RAIN_EFFECT").length;
  const otherLost = effectiveWorkdays.filter((row) => row.classification === "NON_WORKABLE_OTHER").length;
  const workable = Math.max(0, calendarDays - rainLost - rainEffectLost - otherLost);

  const scheduledDates = new Set<string>();
  for (const item of input.budgetItems) {
    if (!item.start_date || !item.end_date || item.start_date > input.asOfDate) continue;
    const end = item.end_date < input.asOfDate ? item.end_date : input.asOfDate;
    for (const date of dateRange(item.start_date, end)) scheduledDates.add(date);
  }
  const plannedDaysElapsed = scheduledDates.size;
  const grossVariance = Math.max(0, calendarDays - plannedDaysElapsed);
  const climateLost = rainLost + rainEffectLost;

  return {
    calendar_days_elapsed: calendarDays,
    workable_days_elapsed: workable,
    rain_lost_days: rainLost,
    rain_effect_lost_days: rainEffectLost,
    other_lost_days: otherLost,
    effective_available_days: workable,
    gross_schedule_variance: grossVariance,
    weather_adjusted_variance: Math.max(0, grossVariance - climateLost),
  };
}
