"use client";

import { ChevronLeft, ChevronRight, Plus, Send, Trash2, Edit3 } from "lucide-react";
import { ScannedPage } from "@/lib/scanner/types";

interface PageListProps {
  pages: ScannedPage[];
  onAddPage: () => void;
  onDeletePage: (id: string) => void;
  onMovePage: (fromIndex: number, toIndex: number) => void;
  onEditPage: (page: ScannedPage) => void;
  onFinalize: () => void;
  isSending: boolean;
}

export function PageList({
  pages,
  onAddPage,
  onDeletePage,
  onMovePage,
  onEditPage,
  onFinalize,
  isSending,
}: PageListProps) {
  return (
    <div
      className="flex flex-col h-full w-full bg-slate-950 select-none overflow-hidden"
      style={{ height: "100dvh", minHeight: "100dvh" }}
    >
      {/* Encabezado */}
      <div
        className="p-4 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between z-10 shrink-0"
        style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top, 0px))' }}
      >
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Documento Escaneado</h2>
          <p className="text-[11px] text-slate-400">
            {pages.length} {pages.length === 1 ? "página lista" : "páginas listas"}
          </p>
        </div>

        <button
          type="button"
          onClick={onAddPage}
          disabled={isSending}
          className="py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 flex items-center gap-1 transition active:scale-95"
        >
          <Plus className="w-3.5 h-3.5" /> Agregar página
        </button>
      </div>

      {/* Lista / Grid de Páginas */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {pages.map((page, index) => (
          <div
            key={page.id}
            className="flex items-center gap-3 p-3 rounded-xl bg-slate-900 border border-slate-800 shadow-md"
          >
            {/* Miniatura */}
            <div className="relative w-20 h-28 bg-slate-800 rounded-lg overflow-hidden border border-slate-700 shrink-0">
              <img
                src={page.processedDataUrl}
                alt={`Página ${index + 1}`}
                className="w-full h-full object-cover"
              />
              <span className="absolute bottom-1 right-1 bg-black/80 text-[10px] text-white px-1.5 py-0.5 rounded font-bold">
                {index + 1}
              </span>
            </div>

            {/* Metadatos y Acciones */}
            <div className="flex-1 flex flex-col justify-between py-1">
              <div>
                <span className="text-xs font-semibold text-slate-200">
                  Página {index + 1}
                </span>
                <p className="text-[11px] text-slate-400 capitalize">
                  Filtro: {page.filter === "bw" ? "B&N" : page.filter}
                </p>
                <p className="text-[10px] text-slate-500">
                  {page.width} × {page.height} px
                </p>
              </div>

              <div className="flex items-center gap-1.5 pt-2">
                {/* Reordenar */}
                <button
                  type="button"
                  onClick={() => onMovePage(index, index - 1)}
                  disabled={index === 0 || isSending}
                  className="p-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 disabled:opacity-30 hover:text-white"
                  title="Mover arriba"
                >
                  <ChevronLeft className="w-3.5 h-3.5 rotate-90" />
                </button>
                <button
                  type="button"
                  onClick={() => onMovePage(index, index + 1)}
                  disabled={index === pages.length - 1 || isSending}
                  className="p-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 disabled:opacity-30 hover:text-white"
                  title="Mover abajo"
                >
                  <ChevronRight className="w-3.5 h-3.5 rotate-90" />
                </button>

                {/* Editar recorte/filtro */}
                <button
                  type="button"
                  onClick={() => onEditPage(page)}
                  disabled={isSending}
                  className="p-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-emerald-400"
                  title="Editar página"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>

                {/* Eliminar */}
                <button
                  type="button"
                  onClick={() => onDeletePage(page.id)}
                  disabled={pages.length === 1 || isSending}
                  className="p-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 disabled:opacity-30 hover:text-red-400"
                  title="Eliminar página"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Barra de Envío */}
      <div
        className="p-4 bg-slate-900/95 border-t border-slate-800 z-10 shrink-0"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <button
          type="button"
          onClick={onFinalize}
          disabled={isSending || pages.length === 0}
          className="w-full py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-98 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-xl shadow-emerald-900/40 disabled:opacity-50 transition"
        >
          <Send className="w-4 h-4" />
          {isSending ? "Generando PDF y enviando al ERP…" : "Finalizar y Enviar al ERP"}
        </button>
      </div>
    </div>
  );
}
