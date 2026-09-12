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
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 shadow-2xs"
          title="Restaurar al Radar"
        >
          <Eye className="h-3.5 w-3.5" />
          Restaurar al Radar
        </button>
      ) : (
        <button
          onClick={() => setModalOpen(true)}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:border-red-200 hover:bg-red-50 hover:text-red-700 shadow-2xs"
          title="Excluir del Radar"
        >
          <EyeOff className="h-3.5 w-3.5" />
          Excluir del Radar
        </button>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl space-y-4 text-left">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                {!isExcluded ? (
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-red-100 text-red-600">
                    <EyeOff className="h-5 w-5" />
                  </div>
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                    <Eye className="h-5 w-5" />
                  </div>
                )}
                <div>
                  <h3 className="text-base font-semibold text-zinc-900">
                    {!isExcluded ? "Excluir del Radar" : "Restaurar al Radar"}
                  </h3>
                  <p className="text-xs text-zinc-500 truncate max-w-[280px]">
                    {supplierName}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="text-zinc-400 hover:text-zinc-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="rounded-lg border border-zinc-100 bg-zinc-50 p-3 text-xs text-zinc-700">
              {!isExcluded ? (
                <p>
                  Este competidor dejará de aparecer en tu Radar.{" "}
                  <strong className="text-zinc-900">
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
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Cancelar
              </button>
              {!isExcluded ? (
                <button
                  type="button"
                  onClick={handleToggle}
                  disabled={isPending}
                  className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 shadow-xs"
                >
                  {isPending ? "Excluyendo..." : "Excluir del Radar"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleToggle}
                  disabled={isPending}
                  className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 shadow-xs"
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
