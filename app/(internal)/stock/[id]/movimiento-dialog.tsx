"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatMoney, formatNumber } from "@/lib/format";
import { createClient } from "@/lib/supabase/browser";
import type { BudgetItem } from "@/lib/types";
import { registrarMovimiento } from "../stock-actions";

type Tipo = "ENTRADA" | "SALIDA" | "AJUSTE";
type ProjectLite = { id: string; name: string; code: string };

export function MovimientoDialog({
  productoId,
  unidad,
  stockActual,
  costoPromedio,
}: {
  productoId: string;
  unidad: string;
  stockActual: number;
  costoPromedio: number;
}) {
  const [open, setOpen] = useState(false);
  const [tipo, setTipo] = useState<Tipo>("ENTRADA");
  const [cantidad, setCantidad] = useState("");
  const [costo, setCosto] = useState("");
  const [notas, setNotas] = useState("");
  const [projectId, setProjectId] = useState("");
  const [budgetItemId, setBudgetItemId] = useState("");
  const [projects, setProjects] = useState<ProjectLite[]>([]);
  const [rubros, setRubros] = useState<BudgetItem[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // Proyectos activos — para imputar la salida a una obra
  useEffect(() => {
    if (!open) return;
    const supabase = createClient();
    supabase
      .from("projects")
      .select("id, name, code")
      .eq("status", "ACTIVO")
      .order("name")
      .then(({ data }) => setProjects((data as ProjectLite[]) ?? []));
  }, [open]);

  // Rubros del proyecto elegido
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("budget_items")
      .select("*")
      .eq("project_id", projectId)
      .order("sort_order")
      .order("code")
      .returns<BudgetItem[]>()
      .then(({ data }) => {
        if (!cancelled) setRubros(data ?? []);
      });
    return () => { cancelled = true; };
  }, [projectId]);

  function cambiarProyecto(id: string) {
    setProjectId(id);
    setBudgetItemId("");
    if (!id) setRubros([]);
  }

  function reset() {
    setTipo("ENTRADA");
    setCantidad("");
    setCosto("");
    setNotas("");
    setProjectId("");
    setBudgetItemId("");
    setRubros([]);
    setError(null);
  }

  const cantidadNum = parseFloat(cantidad) || 0;
  const costoNum = parseFloat(costo) || 0;

  const stockPreview =
    tipo === "ENTRADA"
      ? stockActual + cantidadNum
      : tipo === "SALIDA"
        ? stockActual - cantidadNum
        : cantidadNum;

  // CPP resultante segun la misma formula que la RPC
  let cppPreview = costoPromedio;
  if (tipo === "ENTRADA" && costoNum > 0 && stockPreview > 0) {
    cppPreview = (stockActual * costoPromedio + cantidadNum * costoNum) / stockPreview;
  } else if (tipo === "AJUSTE" && costoNum > 0) {
    cppPreview = costoNum;
  }

  const valorMovimiento =
    tipo === "ENTRADA"
      ? cantidadNum * (costoNum > 0 ? costoNum : costoPromedio)
      : tipo === "SALIDA"
        ? cantidadNum * costoPromedio
        : stockPreview * cppPreview - stockActual * costoPromedio;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (cantidadNum <= 0) {
      setError("La cantidad debe ser mayor a 0");
      return;
    }
    setPending(true);
    setError(null);

    const res = await registrarMovimiento(productoId, tipo, cantidadNum, {
      notas: notas || undefined,
      costo_unitario: costoNum > 0 ? costoNum : undefined,
      project_id: tipo === "SALIDA" && projectId ? projectId : null,
      budget_item_id: tipo === "SALIDA" && projectId && budgetItemId ? budgetItemId : null,
    });
    setPending(false);

    if (res.error) {
      setError(res.error);
      return;
    }
    setOpen(false);
    reset();
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button>Registrar movimiento</Button>
      </DialogTrigger>
      <DialogContent title="Registrar movimiento de stock" className="max-w-sm">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[12px] text-[var(--muted)] mb-1">Tipo</label>
            <div className="flex gap-2">
              {(["ENTRADA", "SALIDA", "AJUSTE"] as Tipo[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTipo(t)}
                  className={`flex-1 h-8 rounded border text-[12px] font-medium transition-colors ${
                    tipo === t
                      ? t === "ENTRADA"
                        ? "bg-[var(--ok-bg)] border-[var(--ok)]/40 text-[var(--ok)]"
                        : t === "SALIDA"
                          ? "bg-[var(--error-bg)] border-[var(--error)]/40 text-[var(--error)]"
                          : "bg-[var(--accent-teal-bg)] border-[var(--accent-teal)]/40 text-[var(--accent-teal)]"
                      : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--hover)]"
                  }`}
                >
                  {t === "ENTRADA" ? "Entrada" : t === "SALIDA" ? "Salida" : "Ajuste"}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-[var(--muted)] mt-1.5">
              {tipo === "ENTRADA" && "Suma al stock existente."}
              {tipo === "SALIDA" && "Resta del stock existente. Falla si no hay suficiente."}
              {tipo === "AJUSTE" && "Fija el stock al valor exacto que ingreses (corrección de inventario)."}
            </p>
          </div>

          <div>
            <label className="block text-[12px] text-[var(--muted)] mb-1">
              {tipo === "AJUSTE" ? "Nuevo stock total" : "Cantidad"} ({unidad})
            </label>
            <input
              type="number"
              min="0"
              step="any"
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              required
              placeholder="0"
              autoFocus
              className="w-full h-8 rounded border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[13px]"
            />
          </div>

          <div>
            <label className="block text-[12px] text-[var(--muted)] mb-1">
              {tipo === "ENTRADA"
                ? `Costo unitario de compra (por ${unidad})`
                : tipo === "AJUSTE"
                  ? `Costo unitario (revalorizar, opcional)`
                  : `Costo unitario`}
            </label>
            {tipo === "SALIDA" ? (
              <div className="h-8 flex items-center rounded border border-[var(--border)] bg-[var(--hover)] px-2.5 text-[13px] text-[var(--muted)]">
                {formatMoney(costoPromedio)} <span className="text-[11px] ml-1">(costo promedio)</span>
              </div>
            ) : (
              <input
                type="number"
                min="0"
                step="any"
                value={costo}
                onChange={(e) => setCosto(e.target.value)}
                placeholder={costoPromedio > 0 ? formatNumber(costoPromedio, 0) : "0"}
                className="w-full h-8 rounded border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[13px]"
              />
            )}
            {tipo === "ENTRADA" ? (
              <p className="text-[11px] text-[var(--muted)] mt-1">
                Vacío = no cambia el costo promedio ({formatMoney(costoPromedio)}).
              </p>
            ) : null}
          </div>

          {tipo === "SALIDA" ? (
            <div className="space-y-2 rounded border border-[var(--border)] bg-[var(--panel-2)] p-2.5">
              <div className="text-[11px] text-[var(--muted)]">Imputar a obra (opcional)</div>
              <select
                value={projectId}
                onChange={(e) => cambiarProyecto(e.target.value)}
                className="w-full h-8 rounded border border-[var(--border)] bg-[var(--panel)] px-2.5 text-[13px]"
              >
                <option value="">— sin imputar —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code ? `${p.code} · ` : ""}{p.name}
                  </option>
                ))}
              </select>
              {projectId ? (
                <select
                  value={budgetItemId}
                  onChange={(e) => setBudgetItemId(e.target.value)}
                  className="w-full h-8 rounded border border-[var(--border)] bg-[var(--panel)] px-2.5 text-[13px]"
                >
                  <option value="">Rubro (opcional)</option>
                  {rubros.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code} · {r.description}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          ) : null}

          {cantidadNum > 0 ? (
            <div className="rounded border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-[12px] space-y-1">
              <div>
                <span className="text-[var(--muted)]">Stock: </span>
                <span className="font-medium">{formatNumber(stockActual, 2)}</span>
                <span className="text-[var(--muted)] mx-1.5">→</span>
                <span className={`font-semibold ${stockPreview < 0 ? "text-[var(--error)]" : ""}`}>
                  {formatNumber(stockPreview, 2)} {unidad}
                </span>
              </div>
              {(tipo === "ENTRADA" && costoNum > 0) || (tipo === "AJUSTE" && costoNum > 0) ? (
                <div>
                  <span className="text-[var(--muted)]">Costo prom.: </span>
                  <span className="font-medium">{formatMoney(costoPromedio)}</span>
                  <span className="text-[var(--muted)] mx-1.5">→</span>
                  <span className="font-semibold">{formatMoney(cppPreview)}</span>
                </div>
              ) : null}
              <div>
                <span className="text-[var(--muted)]">
                  {tipo === "SALIDA" ? "Valor de la salida: " : tipo === "AJUSTE" ? "Impacto en valor: " : "Valor de la entrada: "}
                </span>
                <span className="font-semibold">{formatMoney(valorMovimiento)}</span>
              </div>
            </div>
          ) : null}

          <div>
            <label className="block text-[12px] text-[var(--muted)] mb-1">Notas</label>
            <input
              type="text"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Opcional"
              className="w-full h-8 rounded border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[13px]"
            />
          </div>

          {error ? (
            <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-3 py-2 text-[12px] text-[var(--error)]">
              {error}
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={pending || cantidadNum <= 0}>
              {pending ? "Guardando…" : "Confirmar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
