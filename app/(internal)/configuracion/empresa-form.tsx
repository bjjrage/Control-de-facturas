"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Empresa } from "@/lib/types";
import { updateEmpresaFields } from "./actions";

export function EmpresaForm({ empresa }: { empresa: Empresa }) {
  const [pending, setPending] = useState(false);
  const [ok, setOk] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      action={async (fd) => {
        setPending(true); setOk(false); setError(null);
        const result = await updateEmpresaFields(fd);
        setPending(false);
        if (result.error) setError(result.error);
        else setOk(true);
      }}
      className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 space-y-3"
    >
      <h2 className="text-[14px] font-semibold">Datos de la empresa</h2>
      <p className="text-[12px] text-[var(--muted)]">
        Aparecen en el encabezado de todos los documentos imprimibles.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="nombre">Nombre de la empresa</Label>
          <Input id="nombre" name="nombre" defaultValue={empresa.nombre} required />
        </div>
        <div>
          <Label htmlFor="ruc">RUC</Label>
          <Input id="ruc" name="ruc" defaultValue={empresa.ruc ?? ""} placeholder="ej: 80012345-6" />
        </div>
        <div className="col-span-2">
          <Label htmlFor="direccion">Dirección</Label>
          <Input id="direccion" name="direccion" defaultValue={empresa.direccion ?? ""} placeholder="ej: Av. Mariscal López 1234, Asunción" />
        </div>
        <div>
          <Label htmlFor="telefono">Teléfono</Label>
          <Input id="telefono" name="telefono" defaultValue={empresa.telefono ?? ""} placeholder="+595 21 555-0000" />
        </div>
        <div>
          <Label htmlFor="email_empresa">Email</Label>
          <Input id="email_empresa" name="email_empresa" type="email" defaultValue={empresa.email_empresa ?? ""} placeholder="info@empresa.com" />
        </div>
      </div>

      {error ? (
        <div className="text-[12px] text-[var(--error)]">{error}</div>
      ) : ok ? (
        <div className="text-[12px] text-[var(--ok)]">✓ Datos guardados</div>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Guardando…" : "Guardar datos"}
        </Button>
      </div>
    </form>
  );
}
