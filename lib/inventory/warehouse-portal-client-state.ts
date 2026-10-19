type SavedAttempt = { key: string; payload: string };

/** A rejected server write has no committed attempt to replay. */
export function clearRejectedConsumptionAttempt(
  storage: Pick<Storage, "getItem" | "removeItem">,
  storageKey: string,
  attempt: SavedAttempt | null,
): null {
  const saved = storage.getItem(storageKey);
  if (saved) {
    try {
      if (JSON.parse(saved)?.key === attempt?.key) storage.removeItem(storageKey);
    } catch {
      storage.removeItem(storageKey);
    }
  }
  return null;
}
