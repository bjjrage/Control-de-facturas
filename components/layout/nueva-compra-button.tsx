"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, FileText, ShoppingCart } from "lucide-react";
import { UserRole } from "@/lib/types";

export function NuevaCompraButton({ role }: { role: UserRole }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const canRfq = role === "comercial" || role === "admin";
  const canOrder = role === "comercial" || role === "administracion" || role === "admin";
  if (!canRfq && !canOrder) return null;

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="h-9 inline-flex items-center gap-1.5 rounded-full bg-[var(--primary)] px-3.5 text-[13px] font-medium text-white hover:bg-[var(--primary-hover)]"
      >
        <Plus size={15} />
        Nueva compra
      </button>
      {open ? (
        <div className="absolute right-0 mt-1 w-64 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-1 shadow-lg z-50">
          {canRfq ? (
            <button
              onClick={() => go("/rfqs?nueva=1")}
              className="w-full flex items-start gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-[var(--hover)]"
            >
              <FileText size={16} className="mt-0.5 shrink-0 text-[var(--muted)]" />
              <span>
                <span className="block text-[13px] font-medium">Con presupuesto</span>
                <span className="block text-[11px] text-[var(--muted)]">
                  Pedís cotización a proveedores y autorizás la ganadora
                </span>
              </span>
            </button>
          ) : null}
          {canOrder ? (
            <button
              onClick={() => go("/orders?nueva=1")}
              className="w-full flex items-start gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-[var(--hover)]"
            >
              <ShoppingCart size={16} className="mt-0.5 shrink-0 text-[var(--muted)]" />
              <span>
                <span className="block text-[13px] font-medium">Compra directa</span>
                <span className="block text-[11px] text-[var(--muted)]">
                  Ya sabés a quién le comprás — creás la orden directo
                </span>
              </span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
