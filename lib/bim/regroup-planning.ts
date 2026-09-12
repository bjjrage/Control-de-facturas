// Decide qué grupos existentes de un modelo quedan "bloqueados" (con una
// decisión humana encima: CONFIRMED o REJECTED) y cuáles son candidatos a
// borrarse y regenerarse (SUGGESTED/REVIEW/NO_MATCH, propuestas de la IA sin
// confirmar todavía) la próxima vez que se procese el modelo.
//
// Extraído como función PURA (sin tocar Supabase) para poder testear la
// decisión de idempotencia de processBimGroups (bim-actions.ts) sin
// necesitar una base de datos real — la parte que sí toca la DB (borrar
// bim_element_groups por id, releer bim_elements) es un one-liner una vez
// que se tiene este resultado.
//
// Regla: un grupo queda bloqueado si tiene AL MENOS UNA fila de
// bim_group_matches en estado CONFIRMED o REJECTED — esas son decisiones
// humanas y nunca se pisan ni se borran. Todo lo demás es regenerable.
export interface GroupMatchStatusRow {
  group_id: string;
  status: string;
}

export interface RegroupPlan {
  lockedGroupIds: Set<string>;
  staleGroupIds: string[];
}

const LOCKED_STATUSES = new Set(["CONFIRMED", "REJECTED"]);

export function planRegroup(existingGroupIds: string[], matchRows: GroupMatchStatusRow[]): RegroupPlan {
  const lockedGroupIds = new Set<string>();
  for (const row of matchRows) {
    if (LOCKED_STATUSES.has(row.status)) lockedGroupIds.add(row.group_id);
  }
  const staleGroupIds = existingGroupIds.filter((id) => !lockedGroupIds.has(id));
  return { lockedGroupIds, staleGroupIds };
}
