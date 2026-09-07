"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProjectCertificateStaff } from "@/lib/types";
import { addCertificateStaff, removeCertificateStaff } from "../certificado-anexos-actions";

export function CertificateStaffSection({
  certificateId,
  staff,
  editable,
}: {
  certificateId: string;
  staff: ProjectCertificateStaff[];
  editable: boolean;
}) {
  const router = useRouter();
  const [nombre, setNombre] = useState("");
  const [rol, setRol] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    setError(null);
    const res = await addCertificateStaff(certificateId, nombre, rol);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setNombre("");
    setRol("");
    router.refresh();
  }

  async function remove(id: string) {
    setBusy(true);
    const res = await removeCertificateStaff(id);
    setBusy(false);
    if (!res.error) router.refresh();
  }

  const byRol = staff.reduce<Record<string, ProjectCertificateStaff[]>>((acc, s) => {
    (acc[s.rol] ??= []).push(s);
    return acc;
  }, {});

  return (
    <div className="rounded border border-[var(--border)] bg-[var(--panel-2)] p-3 text-[12px]">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
        Personal empleado en el período
      </div>

      {staff.length === 0 ? (
        <p className="text-[var(--muted)]">Sin personal cargado.</p>
      ) : (
        <div className="space-y-2">
          {Object.entries(byRol).map(([r, people]) => (
            <div key={r}>
              <div className="text-[11px] font-medium text-[var(--muted)]">{r}</div>
              <div className="flex flex-wrap gap-1.5">
                {people.map((p) => (
                  <span
                    key={p.id}
                    className="inline-flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--panel)] px-1.5 py-0.5"
                  >
                    {p.nombre}
                    {editable ? (
                      <button
                        type="button"
                        onClick={() => remove(p.id)}
                        disabled={busy}
                        className="text-[var(--muted)] hover:text-[var(--error)]"
                      >
                        <X size={11} />
                      </button>
                    ) : null}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {editable ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Input
            placeholder="Nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="h-8 w-40"
          />
          <Input
            placeholder="Rol (Oficial, Ayudante…)"
            value={rol}
            onChange={(e) => setRol(e.target.value)}
            className="h-8 w-44"
          />
          <Button disabled={busy || !nombre.trim() || !rol.trim()} onClick={add}>
            Agregar
          </Button>
          {error ? <span className="text-[var(--error)]">{error}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
