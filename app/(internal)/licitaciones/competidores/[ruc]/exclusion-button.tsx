"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, X } from "lucide-react";
import { excluirCompetidoresRadar, restaurarCompetidoresRadar } from "../actions";

interface CompetitorExclusionButtonProps {
  supplierId: string;
  supplierName: string;
  initialIsExcluded: boolean;
}

export function CompetitorExclusionButton({
  supplierId,
  supplierName,
  initialIsExcluded,
}: CompetitorExclusionButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isExcluded, setIsExcluded] = useState(initialIsExcluded);
  const [modalOpen, setModalOpen] = useState(false);

  async function handleToggle() {
    startTransition(async () => {
      if (isExcluded) {
        const res = await restaurarCompetidoresRadar([supplierId]);
        if (res.success) {
          setIsExcluded(false);
          setModalOpen(false);
          router.refresh();
        } else {
          alert(res.error || "No se pudo restaurar");
        }
      } else {
        const res = await excluirCompetidoresRadar([supplierId]);
        if (res.success) {
          setIsExcluded(true);
          setModalOpen(false);
          router.refresh();
        } else {
          alert(res.error || "No se pudo excluir");
        }
      }
    });
  }

  return (
    <>
      {isExcluded ? (
        <button
          onClick={() => setModalOpen(true)}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-900/60 bg-emerald-950/40 px-3 py-1.5 text-xs font-semibold text-emerald-400 hover:bg-emerald-900/50 shadow-2xs transition-colors"
          title="Restaurar al Radar"
        >
          <Eye className="h-3.5 w-3.5" />
          Restaurar al Radar
        </button>
      ) : (
        <button
          onClick={() => setModalOpen(true)}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-1.5 text-xs font-medium text-[var(--muted)] hover:border-red-900/60 hover:bg-red-950/40 hover:text-red-400 shadow-2xs transition-colors"
          title="Excluir del Radar"
        >
          <EyeOff className="h-3.5 w-3.5" />
          Excluir del Radar
        </button>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--panel)] p-6 shadow-2xl space-y-4 text-left">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                {!isExcluded ? (
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-red-950/60 border border-red-900/60 text-red-400">
                    <EyeOff className="h-5 w-5" />
                  </div>
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-950/60 border border-emerald-900/60 text-emerald-400">
                    <Eye className="h-5 w-5" />
                  </div>
                )}
                <div>
                  <h3 className="text-base font-semibold text-[var(--foreground)]">
                    {!isExcluded ? "Excluir del Radar" : "Restaurar al Radar"}
                  </h3>
                  <p className="text-xs text-[var(--muted)] truncate max-w-[280px]">
                    {supplierName}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3 text-xs text-[var(--foreground)]">
              {!isExcluded ? (
                <p>
                  Este competidor dejará de aparecer en tu Radar.{" "}
                  <strong className="text-[var(--foreground)] font-semibold">
                    La evidencia histórica DNCP no se eliminará
                  </strong>
                  .
                </p>
              ) : (
                <p>
                  Este competidor volverá a mostrarse en los listados y comparativas del Radar de tu empresa.
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                disabled={isPending}
                className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-xs font-medium text-[var(--foreground)] hover:bg-[var(--hover)] transition-colors"
              >
                Cancelar
              </button>
              {!isExcluded ? (
                <button
                  type="button"
                  onClick={handleToggle}
                  disabled={isPending}
                  className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-500 shadow-xs transition-colors"
                >
                  {isPending ? "Excluyendo..." : "Excluir del Radar"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleToggle}
                  disabled={isPending}
                  className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 shadow-xs transition-colors"
                >
                  {isPending ? "Restaurando..." : "Restaurar al Radar"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
