"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent } from "@/components/ui/dialog";
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
  const [open,setOpen] = useState(false);
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
    setOpen(false);
    setNombre("");
    setRol("");
    router.refresh();
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    const res = await removeCertificateStaff(id);
    setBusy(false);
    if (res.error) setError(res.error); else router.refresh();
  }

  return (
    <div className="rounded border border-[var(--border)] bg-[var(--panel-2)] p-3 text-[12px]">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
        Personal empleado en el período
      </div>

      <div className="erp-table-shell overflow-x-auto"><table><thead><tr><th>Persona</th><th>Rol del período</th><th>Acciones</th></tr></thead><tbody>{staff.map(p=><tr key={p.id}><td>{p.nombre}</td><td>{p.rol}</td><td>{editable&&<Button size="sm" variant="ghost" disabled={busy} onClick={()=>remove(p.id)}>Quitar</Button>}</td></tr>)}</tbody></table>{!staff.length&&<p className="p-3 text-[var(--muted)]">Sin personal cargado.</p>}</div>
      {editable&&<Button size="sm" variant="secondary" onClick={()=>setOpen(true)}>+ Agregar personal</Button>}
      {error && !open ? <p role="alert" className="mt-2 text-[var(--error)]">{error}</p> : null}

      {editable ? (
        <Dialog open={open} onOpenChange={setOpen}><DialogContent title="Agregar personal al certificado"><div className="space-y-3">
          <Input
            aria-label="Nombre" placeholder="Nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}

          />
          <Input
            aria-label="Rol" placeholder="Rol (Oficial, Ayudante…)"
            value={rol}
            onChange={(e) => setRol(e.target.value)}

          />
          <Button disabled={busy || !nombre.trim() || !rol.trim()} onClick={add}>
            Agregar
          </Button>
          <Button variant="secondary" onClick={()=>setOpen(false)}>Cancelar</Button>
          {error ? <span role="alert" className="text-[var(--error)]">{error}</span> : null}
        </div></DialogContent></Dialog>
      ) : null}
    </div>
  );
}
