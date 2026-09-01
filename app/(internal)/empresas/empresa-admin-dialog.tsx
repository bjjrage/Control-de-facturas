"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { createEmpresaAdmin } from "./actions";

export function EmpresaAdminDialog({
  empresaId,
  empresaNombre,
  trigger,
}: {
  empresaId: string;
  empresaNombre: string;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={`Nuevo usuario — ${empresaNombre}`}>
        <form
          className="space-y-3"
          action={async (formData: FormData) => {
            setPending(true);
            const result = await createEmpresaAdmin(formData);
            setPending(false);
            if (result?.error) {
              setError(result.error);
              return;
            }
            setError(null);
            setOpen(false);
          }}
        >
          <input type="hidden" name="empresa_id" value={empresaId} />
          {error ? (
            <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
              {error}
            </div>
          ) : null}
          <div>
            <Label htmlFor="ea_full_name">Nombre completo</Label>
            <Input id="ea_full_name" name="full_name" required autoFocus />
          </div>
          <div>
            <Label htmlFor="ea_email">Email</Label>
            <Input id="ea_email" name="email" type="email" required />
          </div>
          <div>
            <Label htmlFor="ea_password">Contraseña inicial</Label>
            <Input id="ea_password" name="password" type="password" required minLength={6} />
          </div>
          <div>
            <Label htmlFor="ea_role">Rol</Label>
            <Select id="ea_role" name="role" defaultValue="admin" required>
              <option value="admin">Admin</option>
              <option value="administracion">Administración</option>
              <option value="comercial">Comercial</option>
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creando…" : "Crear usuario"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
