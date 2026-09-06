"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Provider } from "@/lib/types";
import { linkProviderToProject, createProviderForProject } from "./provider-actions";

type Mode = "existing" | "new";

export function AddProjectProviderDialog({
  projectId,
  availableProviders,
  trigger,
}: {
  projectId: string;
  /** Proveedores de la empresa que todavía no están en esta obra. */
  availableProviders: Provider[];
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>(availableProviders.length > 0 ? "existing" : "new");
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  function close() {
    setOpen(false);
    setError(null);
    setSelected("");
  }

  async function handleExisting() {
    if (!selected) {
      setError("Elegí un proveedor.");
      return;
    }
    setPending(true);
    const result = await linkProviderToProject(projectId, selected);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    close();
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title="Agregar proveedor a la obra">
        <div className="space-y-3">
          {availableProviders.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode("existing")}
                className={[
                  "rounded-lg border-2 p-3 text-left transition-colors",
                  mode === "existing"
                    ? "border-[var(--primary)] bg-[var(--primary-bg)]"
                    : "border-[var(--border)] hover:border-[var(--primary)]/40",
                ].join(" ")}
              >
                <div className="text-[13px] font-semibold mb-0.5">Ya existe</div>
                <div className="text-[11px] text-[var(--muted)] leading-snug">
                  Elegir de los proveedores que ya cargaste en la empresa
                </div>
              </button>
              <button
                type="button"
                onClick={() => setMode("new")}
                className={[
                  "rounded-lg border-2 p-3 text-left transition-colors",
                  mode === "new"
                    ? "border-[var(--primary)] bg-[var(--primary-bg)]"
                    : "border-[var(--border)] hover:border-[var(--primary)]/40",
                ].join(" ")}
              >
                <div className="text-[13px] font-semibold mb-0.5">Nuevo proveedor</div>
                <div className="text-[11px] text-[var(--muted)] leading-snug">
                  Todavía no existe, lo cargo ahora
                </div>
              </button>
            </div>
          ) : null}

          {error ? (
            <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
              {error}
            </div>
          ) : null}

          {mode === "existing" ? (
            <div className="space-y-3">
              <div>
                <Label htmlFor="existing_provider">Proveedor</Label>
                <Select
                  id="existing_provider"
                  value={selected}
                  onChange={(e) => setSelected((e.target as HTMLSelectElement).value)}
                >
                  <option value="">Elegí un proveedor</option>
                  {availableProviders.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.tax_id ? ` — ${p.tax_id}` : ""}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="secondary" onClick={close}>
                  Cancelar
                </Button>
                <Button type="button" disabled={pending} onClick={handleExisting}>
                  {pending ? "Agregando…" : "Agregar"}
                </Button>
              </div>
            </div>
          ) : (
            <form
              className="space-y-3"
              action={async (formData: FormData) => {
                setPending(true);
                const result = await createProviderForProject(projectId, formData);
                setPending(false);
                if (result.error) {
                  setError(result.error);
                  return;
                }
                close();
                router.refresh();
              }}
            >
              <div>
                <Label htmlFor="name">Nombre</Label>
                <Input id="name" name="name" required />
              </div>
              <div>
                <Label htmlFor="contact_name">Contacto</Label>
                <Input id="contact_name" name="contact_name" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" name="email" type="email" />
                </div>
                <div>
                  <Label htmlFor="phone">Teléfono</Label>
                  <Input id="phone" name="phone" />
                </div>
              </div>
              <div>
                <Label htmlFor="tax_id">RUC</Label>
                <Input id="tax_id" name="tax_id" />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="secondary" onClick={close}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? "Creando…" : "Crear y agregar"}
                </Button>
              </div>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
