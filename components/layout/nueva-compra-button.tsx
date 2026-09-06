"use client";

import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import { UserRole } from "@/lib/types";

// Compra directa: creás la orden sabiendo ya a quién le comprás. El circuito
// "con presupuesto" (pedir cotización y autorizar la ganadora) vive en
// Solicitudes → Nueva solicitud, no acá.
export function NuevaCompraButton({ role }: { role: UserRole }) {
  const canOrder = role === "comercial" || role === "administracion" || role === "admin";
  if (!canOrder) return null;

  return (
    <Link
      href="/orders?nueva=1"
      className="h-9 inline-flex items-center gap-1.5 rounded-full bg-[var(--primary)] px-3.5 text-[13px] font-medium text-white hover:bg-[var(--primary-hover)]"
    >
      <ShoppingCart size={15} />
      Compra directa
    </Link>
  );
}
