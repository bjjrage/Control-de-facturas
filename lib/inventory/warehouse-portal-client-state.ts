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

type SubmissionData = {
  ok?: boolean;
  partial?: boolean;
  uploadIncomplete?: boolean;
  error?: string;
  uploaded?: number;
  total?: number;
  rejected?: Array<{ file: string; reason: string }>;
  pendingUploads?: Array<{ file_name?: string; reason?: string }>;
};

export function classifyWarehouseSubmission(status: number, data: SubmissionData): { complete: boolean; message: string } {
  if (status === 207 || data.partial || data.uploadIncomplete) {
    const pending = data.pendingUploads?.map(item => `${item.file_name ?? "Archivo sin nombre"}${item.reason ? `: ${item.reason}` : ""}`).join("; ");
    if (pending) return {
      complete: false,
      message: `Adjuntos pendientes: ${pending}. Reenviá esos archivos para completar la rendición; los ya guardados se conservan.`,
    };
    const rejected = data.rejected?.map(item => item.file).join(", ");
    return {
      complete: false,
      message: data.error ?? `Carga parcial${data.uploaded !== undefined && data.total !== undefined ? ` (${data.uploaded}/${data.total})` : ""}. ${rejected ? `Pendiente: ${rejected}.` : "Revisá los archivos pendientes y reintentá."}`,
    };
  }
  if (status < 200 || status >= 300 || data.ok === false) {
    return { complete: false, message: data.error ?? "No se pudo enviar la rendición." };
  }
  return { complete: true, message: "Rendición enviada con éxito. La empresa revisará la evidencia." };
}
