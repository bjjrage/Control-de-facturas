"use client";

import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import { UserRole } from "@/lib/types";
import { primaryButtonClass } from "@/components/ui/button";
import { cn } from "@/lib/cn";

// Compra directa: creás la orden sabiendo ya a quién le comprás. El circuito
// "con presupuesto" (pedir cotización y autorizar la ganadora) vive en
// Solicitudes → Nueva solicitud, no acá.
export function NuevaCompraButton({ role }: { role: UserRole }) {
  const canOrder = role === "comercial" || role === "administracion" || role === "admin";
  if (!canOrder) return null;

  return (
    <Link
      href="/orders?nueva=1"
      className={cn("h-9 inline-flex items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium border", primaryButtonClass)}
    >
      <ShoppingCart size={15} />
      Compra directa
    </Link>
  );
}
