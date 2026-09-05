"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    // Supabase puts the session from the recovery link into the hash fragment.
    // onAuthStateChange fires with SIGNED_IN / PASSWORD_RECOVERY once the client
    // parses the fragment — no manual token extraction needed.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setReady(true);
      }
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError("Las contraseñas no coinciden."); return; }
    if (password.length < 6) { setError("Mínimo 6 caracteres."); return; }
    setLoading(true);
    setError("");
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) { setError(err.message); setLoading(false); return; }
    router.push("/dashboard");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] px-4">
      <div className="w-full max-w-[340px]">
        <div className="mb-6 flex justify-start">
          <Image src="/logo/niupack-wordmark.svg" alt="niupack" width={120} height={26} priority />
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
          <h1 className="text-[15px] font-semibold mb-0.5">Nueva contraseña</h1>
          <p className="text-[12px] text-[var(--muted)] mb-4">Elegí una nueva contraseña para tu cuenta.</p>
          {!ready ? (
            <p className="text-[13px] text-[var(--muted)]">Verificando enlace…</p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3">
              {error ? (
                <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
                  {error}
                </div>
              ) : null}
              <div>
                <Label htmlFor="password">Nueva contraseña</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div>
                <Label htmlFor="confirm">Confirmar contraseña</Label>
                <Input
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Guardando…" : "Guardar contraseña"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
