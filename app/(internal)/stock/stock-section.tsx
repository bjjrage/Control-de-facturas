"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Producto, CategoriaProducto, Deposito } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Label, Select } from "@/components/ui/input";
import { formatMoney, formatNumber } from "@/lib/format";
import { CategoriasDialog } from "./categorias-dialog";
import { DepositosDialog } from "./depositos-dialog";
import { ImportarDialog } from "./importar-dialog";

const SIN_CATEGORIA = "__sin__";

type EstadoFiltro = "activos" | "inactivos" | "todos";
type Situacion = "" | "bajo" | "sin" | "ok";
type SortKey = "nombre" | "categoria" | "sku" | "stock" | "minimo" | "situacion" | "costo" | "valor";
type SortDir = "asc" | "desc";

const valorDe = (p: Producto) => p.stock_actual * p.costo_promedio;

const SIT_LABEL: Record<"sin" | "bajo" | "ok", string> = {
  sin: "Sin stock",
  bajo: "Bajo mínimo",
  ok: "En nivel",
};
const SIT_RANK: Record<"sin" | "bajo" | "ok", number> = { sin: 0, bajo: 1, ok: 2 };

function situacionDe(p: Producto): "sin" | "bajo" | "ok" {
  if (p.stock_actual <= 0) return "sin";
  if (p.stock_minimo > 0 && p.stock_actual <= p.stock_minimo) return "bajo";
  return "ok";
}

export function StockSection({
  productos,
  categorias,
  depositos,
}: {
  productos: Producto[];
  categorias: CategoriaProducto[];
  depositos: Deposito[];
}) {
  const [q, setQ] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [estado, setEstado] = useState<EstadoFiltro>("activos");
  const [situacion, setSituacion] = useState<Situacion>("");
  const [agrupar, setAgrupar] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("nombre");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const catById = useMemo(() => {
    const m = new Map<string, CategoriaProducto>();
    for (const c of categorias) m.set(c.id, c);
    return m;
  }, [categorias]);

  function nombreCategoria(p: Producto): string {
    if (p.categoria_id && catById.has(p.categoria_id)) return catById.get(p.categoria_id)!.nombre;
    return "Sin categoría";
  }

  const activos = useMemo(() => productos.filter((p) => p.activo), [productos]);
  const kpiBajo = useMemo(() => activos.filter((p) => situacionDe(p) === "bajo").length, [activos]);
  const kpiSin = useMemo(() => activos.filter((p) => situacionDe(p) === "sin").length, [activos]);
  const valorInventario = useMemo(
    () => activos.reduce((acc, p) => acc + valorDe(p), 0),
    [activos]
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return productos.filter((p) => {
      if (estado === "activos" && !p.activo) return false;
      if (estado === "inactivos" && p.activo) return false;

      if (catFilter === SIN_CATEGORIA) {
        if (p.categoria_id && catById.has(p.categoria_id)) return false;
      } else if (catFilter && p.categoria_id !== catFilter) {
        return false;
      }

      if (situacion && situacionDe(p) !== situacion) return false;

      if (term) {
        const hay =
          p.nombre.toLowerCase().includes(term) ||
          (p.sku ?? "").toLowerCase().includes(term) ||
          (p.descripcion ?? "").toLowerCase().includes(term);
        if (!hay) return false;
      }
      return true;
    });
  }, [productos, q, catFilter, estado, situacion, catById]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "nombre":
          cmp = a.nombre.localeCompare(b.nombre, "es");
          break;
        case "categoria":
          cmp = nombreCategoria(a).localeCompare(nombreCategoria(b), "es");
          break;
        case "sku":
          cmp = (a.sku ?? "").localeCompare(b.sku ?? "", "es");
          break;
        case "stock":
          cmp = a.stock_actual - b.stock_actual;
          break;
        case "minimo":
          cmp = a.stock_minimo - b.stock_minimo;
          break;
        case "situacion":
          cmp = SIT_RANK[situacionDe(a)] - SIT_RANK[situacionDe(b)];
          break;
        case "costo":
          cmp = a.costo_promedio - b.costo_promedio;
          break;
        case "valor":
          cmp = valorDe(a) - valorDe(b);
          break;
      }
      if (cmp === 0) cmp = a.nombre.localeCompare(b.nombre, "es");
      return cmp * dir;
    });
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortKey, sortDir, catById]);

  const grupos = useMemo(() => {
    const map = new Map<string, Producto[]>();
    for (const p of sorted) {
      const key = p.categoria_id && catById.has(p.categoria_id) ? p.categoria_id : SIN_CATEGORIA;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    const out: { id: string; nombre: string; items: Producto[] }[] = [];
    for (const c of categorias) {
      const items = map.get(c.id);
      if (items) out.push({ id: c.id, nombre: c.nombre, items });
    }
    const sin = map.get(SIN_CATEGORIA);
    if (sin) out.push({ id: SIN_CATEGORIA, nombre: "Sin categoría", items: sin });
    return out;
  }, [sorted, categorias, catById]);

  const activeChips: { label: string; clear: () => void }[] = [];
  if (q.trim()) activeChips.push({ label: `Búsqueda: "${q.trim()}"`, clear: () => setQ("") });
  if (catFilter) {
    const nombre =
      catFilter === SIN_CATEGORIA ? "Sin categoría" : catById.get(catFilter)?.nombre ?? "—";
    activeChips.push({ label: `Categoría: ${nombre}`, clear: () => setCatFilter("") });
  }
  if (situacion)
    activeChips.push({ label: `Situación: ${SIT_LABEL[situacion]}`, clear: () => setSituacion("") });
  if (estado !== "activos")
    activeChips.push({
      label: `Estado: ${estado === "inactivos" ? "Inactivos" : "Todos"}`,
      clear: () => setEstado("activos"),
    });

  const hasFilters = activeChips.length > 0;

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function limpiar() {
    setQ("");
    setCatFilter("");
    setEstado("activos");
    setSituacion("");
  }

  function sortBy(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sortProps = { sortKey, sortDir, sortBy };

  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[17px] font-semibold">Stock</h1>
          <p className="text-[12px] text-[var(--muted)] mt-0.5">
            {activos.length} {activos.length === 1 ? "producto activo" : "productos activos"} ·{" "}
            {categorias.length} {categorias.length === 1 ? "categoría" : "categorías"}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <CategoriasDialog categorias={categorias} productos={productos} />
          <DepositosDialog depositos={depositos} />
          <ImportarDialog />
          <Link
            href="/stock/export"
            className="inline-flex items-center justify-center rounded-md border px-3 h-8 text-[13px] font-medium bg-[var(--panel)] hover:bg-[var(--hover)] border-[var(--border)]"
          >
            Exportar CSV
          </Link>
          <Link href="/stock/nuevo">
            <Button>Nuevo producto</Button>
          </Link>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi
          label="Valor del inventario"
          text={valorInventario > 0 ? formatMoney(valorInventario) : "—"}
          hint={`${activos.length} productos activos`}
        />
        <Kpi
          label="Bajo mínimo"
          value={kpiBajo}
          tone={kpiBajo > 0 ? "warn" : undefined}
          onClick={kpiBajo > 0 ? () => { setSituacion("bajo"); setEstado("activos"); } : undefined}
        />
        <Kpi
          label="Sin stock"
          value={kpiSin}
          tone={kpiSin > 0 ? "error" : undefined}
          onClick={kpiSin > 0 ? () => { setSituacion("sin"); setEstado("activos"); } : undefined}
        />
        <Kpi label="Categorías" value={categorias.length} />
      </div>

      {categorias.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--panel)] px-4 py-3 text-[12px] text-[var(--muted)] flex items-center justify-between gap-3">
          <span>
            Todavía no hay categorías. Agrupá el inventario por rubro para poder filtrar y que la
            lista no se vuelva interminable.
          </span>
          <CategoriasDialog
            categorias={categorias}
            productos={productos}
            trigger={
              <Button variant="secondary" className="h-7 px-2.5 text-[12px] shrink-0">
                Crear categorías
              </Button>
            }
          />
        </div>
      ) : null}

      {/* Filtros */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 space-y-2.5">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="stk-q">Buscar</Label>
            <Input
              id="stk-q"
              type="search"
              placeholder="Nombre, SKU, descripción…"
              value={q}
              onChange={(e) => setQ((e.target as HTMLInputElement).value)}
              className="w-64"
            />
          </div>
          <div>
            <Label htmlFor="stk-cat">Categoría</Label>
            <Select
              id="stk-cat"
              value={catFilter}
              onChange={(e) => setCatFilter((e.target as HTMLSelectElement).value)}
              className="w-52"
            >
              <option value="">Todas</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
              <option value={SIN_CATEGORIA}>Sin categoría</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="stk-sit">Situación</Label>
            <Select
              id="stk-sit"
              value={situacion}
              onChange={(e) => setSituacion((e.target as HTMLSelectElement).value as Situacion)}
              className="w-40"
            >
              <option value="">Todas</option>
              <option value="bajo">Bajo mínimo</option>
              <option value="sin">Sin stock</option>
              <option value="ok">En nivel</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="stk-est">Estado</Label>
            <Select
              id="stk-est"
              value={estado}
              onChange={(e) => setEstado((e.target as HTMLSelectElement).value as EstadoFiltro)}
              className="w-36"
            >
              <option value="activos">Activos</option>
              <option value="inactivos">Inactivos</option>
              <option value="todos">Todos</option>
            </Select>
          </div>
          <label className="flex items-center gap-1.5 text-[12px] text-[var(--muted)] pb-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={agrupar}
              onChange={(e) => setAgrupar(e.target.checked)}
            />
            Agrupar por categoría
          </label>
        </div>

        {hasFilters ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {activeChips.map((chip) => (
              <button
                key={chip.label}
                onClick={chip.clear}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--panel-2)] px-2 py-0.5 text-[11px] text-[var(--muted)] hover:text-[var(--foreground)]"
              >
                {chip.label}
                <span className="text-[13px] leading-none">×</span>
              </button>
            ))}
            <span className="text-[11px] text-[var(--muted)] ml-0.5">
              {filtered.length} {filtered.length === 1 ? "producto" : "productos"}
            </span>
            <button
              onClick={limpiar}
              className="text-[11px] text-[var(--muted)] underline hover:text-[var(--foreground)] ml-1"
            >
              Limpiar todo
            </button>
          </div>
        ) : null}
      </div>

      {/* Lista */}
      {sorted.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] py-10 text-center text-[13px] text-[var(--muted)]">
          {productos.length === 0 ? (
            <>
              No hay productos.{" "}
              <Link href="/stock/nuevo" className="text-action">
                Creá el primero.
              </Link>
            </>
          ) : (
            "Ningún producto coincide con los filtros."
          )}
        </div>
      ) : agrupar ? (
        <div className="space-y-2">
          {grupos.map((g) => {
            const isCollapsed = collapsed.has(g.id);
            const bajo = g.items.filter((p) => p.activo && situacionDe(p) === "bajo").length;
            const sin = g.items.filter((p) => p.activo && situacionDe(p) === "sin").length;
            const valorGrupo = g.items.reduce((acc, p) => acc + valorDe(p), 0);
            return (
              <div
                key={g.id}
                className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden"
              >
                <button
                  onClick={() => toggle(g.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--hover)] transition-colors"
                >
                  <span
                    className={`text-[var(--muted)] text-[10px] transition-transform ${
                      isCollapsed ? "" : "rotate-90"
                    }`}
                  >
                    ▶
                  </span>
                  <span className="text-[13px] font-semibold">{g.nombre}</span>
                  <span className="text-[11px] text-[var(--muted)]">
                    {g.items.length} {g.items.length === 1 ? "ítem" : "ítems"}
                  </span>
                  {valorGrupo > 0 ? (
                    <span className="text-[11px] text-[var(--muted)] tabular-nums">
                      · {formatMoney(valorGrupo)}
                    </span>
                  ) : null}
                  <span className="flex-1" />
                  {sin > 0 ? <Badge tone="error">{sin} sin stock</Badge> : null}
                  {bajo > 0 ? <Badge tone="warn">{bajo} bajo mínimo</Badge> : null}
                </button>

                {!isCollapsed ? (
                  <div className="overflow-x-auto border-t border-[var(--border)]">
                    <Tabla items={g.items} nombreCategoria={nombreCategoria} {...sortProps} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
          <div className="overflow-x-auto">
            <Tabla items={sorted} nombreCategoria={nombreCategoria} {...sortProps} />
          </div>
        </div>
      )}
    </div>
  );
}

function Th({
  label,
  col,
  num,
  sortKey,
  sortDir,
  sortBy,
}: {
  label: string;
  col: SortKey;
  num?: boolean;
  sortKey: SortKey;
  sortDir: SortDir;
  sortBy: (k: SortKey) => void;
}) {
  const active = sortKey === col;
  return (
    <th className={num ? "num" : undefined}>
      <button
        onClick={() => sortBy(col)}
        className={`inline-flex items-center gap-1 hover:text-[var(--foreground)] ${
          active ? "text-[var(--foreground)]" : ""
        }`}
      >
        {label}
        <span className="text-[9px] w-2">{active ? (sortDir === "asc" ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );
}

function Tabla({
  items,
  nombreCategoria,
  sortKey,
  sortDir,
  sortBy,
}: {
  items: Producto[];
  nombreCategoria: (p: Producto) => string;
  sortKey: SortKey;
  sortDir: SortDir;
  sortBy: (k: SortKey) => void;
}) {
  const sp = { sortKey, sortDir, sortBy };
  return (
    <table>
      <thead>
        <tr>
          <Th label="Producto" col="nombre" {...sp} />
          <Th label="Categoría" col="categoria" {...sp} />
          <Th label="Stock actual" col="stock" num {...sp} />
          <Th label="Costo prom." col="costo" num {...sp} />
          <Th label="Valor" col="valor" num {...sp} />
          <Th label="Estado" col="situacion" {...sp} />
          <th></th>
        </tr>
      </thead>
      <tbody>
        {items.map((p) => {
          const s = situacionDe(p);
          const alerta = p.activo && (s === "bajo" || s === "sin");
          return (
            <tr key={p.id}>
              <td>
                <Link href={`/stock/${p.id}`} className="text-action font-medium">
                  {p.nombre}
                </Link>
                {p.sku ? (
                  <div className="text-[11px] text-[var(--muted)] font-mono">{p.sku}</div>
                ) : p.descripcion ? (
                  <div className="text-[11px] text-[var(--muted)] truncate max-w-[320px]">{p.descripcion}</div>
                ) : null}
              </td>
              <td className="text-[var(--muted)] text-[12px]">{nombreCategoria(p)}</td>
              <td className={`num font-semibold ${alerta ? "text-[var(--warn)]" : ""}`}>
                {formatNumber(p.stock_actual, 2)} {p.unidad}
                {p.contenido_por_unidad && p.unidad_base ? (
                  <div className="text-[11px] text-[var(--muted)] font-normal">
                    {formatNumber(p.stock_actual * p.contenido_por_unidad, 2)} {p.unidad_base}
                  </div>
                ) : null}
              </td>
              <td className="num text-[var(--muted)] tabular-nums">
                {p.costo_promedio > 0 ? formatMoney(p.costo_promedio) : "—"}
              </td>
              <td className="num tabular-nums">
                {valorDe(p) > 0 ? formatMoney(valorDe(p)) : "—"}
              </td>
              <td>
                {!p.activo ? (
                  <Badge tone="neutral">Inactivo</Badge>
                ) : (
                  <span
                    className={`text-[11px] font-medium ${
                      s === "sin"
                        ? "text-[var(--error)]"
                        : s === "bajo"
                          ? "text-[var(--warn)]"
                          : "text-[var(--ok)]"
                    }`}
                  >
                    {SIT_LABEL[s]}
                  </span>
                )}
              </td>
              <td>
                <Link
                  href={`/stock/${p.id}/editar`}
                  className="text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
                >
                  ✏️
                </Link>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Kpi({
  label,
  value,
  text,
  hint,
  tone,
  onClick,
}: {
  label: string;
  value?: number;
  text?: string;
  hint?: string;
  tone?: "warn" | "error";
  onClick?: () => void;
}) {
  const color =
    tone === "error"
      ? "text-[var(--error)]"
      : tone === "warn"
        ? "text-[var(--warn)]"
        : "";
  const inner = (
    <>
      <div className="text-[11px] text-[var(--muted)] mb-1">{label}</div>
      <div
        className={`font-semibold tabular-nums ${color} ${
          text ? "text-[16px]" : "text-[22px]"
        }`}
      >
        {text ?? value}
      </div>
      {hint ? <div className="text-[11px] text-[var(--muted)] mt-0.5">{hint}</div> : null}
    </>
  );
  if (onClick) {
    return (
      <button
        onClick={onClick}
        className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 text-left hover:border-[var(--muted)] transition-colors"
      >
        {inner}
      </button>
    );
  }
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">{inner}</div>
  );
}
