// ---------------------------------------------------------------------------
// Insumos necesarios de una obra: cantidad de cada partida × su APU de
// materiales, sumado por producto. Agrupado por rubro (categoría de
// producto) para mandar un RFQ por rubro a los proveedores de ese rubro.
// ---------------------------------------------------------------------------

export interface NeedsPartida {
  id: string;
  quantity: number | null;
}

export interface NeedsMaterialLine {
  budgetItemId: string;
  productoId: string;
  cantidadPorUnidad: number;
  desperdicioPct: number;
}

export interface MaterialNeed {
  productoId: string;
  cantidad: number;
  partidas: string[];
}

export function explodeMaterialNeeds(partidas: NeedsPartida[], materials: NeedsMaterialLine[]): MaterialNeed[] {
  const qtyById = new Map(partidas.map((p) => [p.id, Number(p.quantity) || 0]));
  const acc = new Map<string, MaterialNeed>();
  for (const m of materials) {
    const qty = qtyById.get(m.budgetItemId) ?? 0;
    if (qty <= 0) continue;
    const cantidad = qty * m.cantidadPorUnidad * (1 + m.desperdicioPct / 100);
    if (!(cantidad > 0)) continue;
    const prev = acc.get(m.productoId);
    if (prev) {
      prev.cantidad += cantidad;
      if (!prev.partidas.includes(m.budgetItemId)) prev.partidas.push(m.budgetItemId);
    } else {
      acc.set(m.productoId, { productoId: m.productoId, cantidad, partidas: [m.budgetItemId] });
    }
  }
  return [...acc.values()].map((n) => ({ ...n, cantidad: Number(n.cantidad.toFixed(4)) }));
}

export interface NeedsProducto {
  id: string;
  nombre: string;
  unidad: string;
  categoriaId: string | null;
}

export interface RubroNeeds {
  categoriaId: string;
  items: (MaterialNeed & { nombre: string; unidad: string })[];
}

/**
 * Agrupa las necesidades por rubro. Los productos sin categoría no pueden
 * ir a ningún RFQ (no se sabe a qué proveedores mandarlos): quedan aparte
 * para que el usuario les asigne rubro, nunca se descartan en silencio.
 */
export function groupNeedsByRubro(
  needs: MaterialNeed[],
  productos: NeedsProducto[]
): { rubros: RubroNeeds[]; sinRubro: (MaterialNeed & { nombre: string })[]; sinProducto: MaterialNeed[] } {
  const byId = new Map(productos.map((p) => [p.id, p]));
  const rubros = new Map<string, RubroNeeds>();
  const sinRubro: (MaterialNeed & { nombre: string })[] = [];
  const sinProducto: MaterialNeed[] = [];
  for (const n of needs) {
    const p = byId.get(n.productoId);
    if (!p) {
      sinProducto.push(n);
      continue;
    }
    if (!p.categoriaId) {
      sinRubro.push({ ...n, nombre: p.nombre });
      continue;
    }
    if (!rubros.has(p.categoriaId)) rubros.set(p.categoriaId, { categoriaId: p.categoriaId, items: [] });
    rubros.get(p.categoriaId)!.items.push({ ...n, nombre: p.nombre, unidad: p.unidad });
  }
  for (const r of rubros.values()) r.items.sort((a, b) => a.nombre.localeCompare(b.nombre));
  return { rubros: [...rubros.values()], sinRubro, sinProducto };
}
