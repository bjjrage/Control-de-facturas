"use client";

import { useState, useTransition } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { resetUserPassword, toggleUserActive, deleteUser } from "./actions";

export function UserRowActions({
  userId,
  email,
  active,
  isSelf,
}: {
  userId: string;
  email: string;
  active: boolean;
  isSelf: boolean;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [pwMsg, setPwMsg] = useState<string | null>(null);

  if (isSelf) return <span className="text-[11px] text-[var(--muted)]">vos</span>;

  return (
    <div className="flex items-center justify-end gap-1">
      {msg ? <span className="text-[11px] text-[var(--error)] mr-1">{msg}</span> : null}

      <Dialog open={pwOpen} onOpenChange={setPwOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" className="h-6 px-2 text-[12px]">
            Contraseña
          </Button>
        </DialogTrigger>
        <DialogContent title={`Nueva contraseña — ${email}`}>
          <div className="space-y-3">
            {pwMsg ? (
              <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
                {pwMsg}
              </div>
            ) : null}
            <div>
              <Label htmlFor="new_pw">Contraseña</Label>
              <Input id="new_pw" type="text" value={pw} onChange={(e) => setPw(e.target.value)} minLength={6} />
              <p className="text-[11px] text-[var(--muted)] mt-1">
                Se la pasás vos a la persona. Puede cambiarla después.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setPwOpen(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={pending || pw.length < 6}
                onClick={() =>
                  start(async () => {
                    const r = await resetUserPassword(userId, pw);
                    if (r?.error) {
                      setPwMsg(r.error);
                      return;
                    }
                    setPwMsg(null);
                    setPw("");
                    setPwOpen(false);
                  })
                }
              >
                Cambiar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Button
        variant="ghost"
        className="h-6 px-2 text-[12px]"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await toggleUserActive(userId, !active);
            setMsg(r?.error ?? null);
          })
        }
      >
        {active ? "Desactivar" : "Activar"}
      </Button>

      <Button
        variant="ghost"
        className="h-6 px-2 text-[12px] text-[var(--error)]"
        disabled={pending}
        onClick={() => {
          if (!confirm(`¿Eliminar a ${email}? Si ya registró operaciones, desactivalo en vez de borrarlo.`)) return;
          start(async () => {
            const r = await deleteUser(userId);
            setMsg(r?.error ?? null);
          });
        }}
      >
        Eliminar
      </Button>
    </div>
  );
}
