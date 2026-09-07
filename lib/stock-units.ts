// Vocabulario controlado de unidades de stock.
// Agregar aquí para que aparezcan en todos los selectores.

export const UNIDADES_COMPRA = [
  "unidad",
  "par",
  "bolsa",
  "saco",
  "caja",
  "paquete",
  "rollo",
  "pallet",
  "tambor",
  "bidón",
  "kg",
  "g",
  "tonelada",
  "lt",
  "ml",
  "m",
  "m²",
  "m³",
] as const;

export const UNIDADES_BASE = [
  "kg",
  "g",
  "tonelada",
  "lt",
  "ml",
  "m",
  "m²",
  "m³",
  "unidad",
] as const;

export type UnidadCompra = (typeof UNIDADES_COMPRA)[number];
export type UnidadBase = (typeof UNIDADES_BASE)[number];
