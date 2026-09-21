export function toFormData(values: Record<string, unknown>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "object") {
      form.set(key, JSON.stringify(value));
    } else {
      form.set(key, String(value));
    }
  }
  return form;
}

export function actionResult(result: unknown): Record<string, unknown> {
  if (result && typeof result === "object") {
    const row = result as Record<string, unknown>;
    if (typeof row.error === "string" && row.error.trim()) throw new Error(row.error);
    return row;
  }
  return { result: result ?? null };
}
