"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

import { dejarDeSeguirLicitacion, importarLicitacion } from "../actions";

export function ReimportarButton({ nro, id }: { nro: string; id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Button
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const res = await importarLicitacion(nro);
            setBusy(false);
            if (res.error) setError(res.error);
            else router.refresh();
          }}
        >
          {busy ? "Sincronizando…" : "Re-sincronizar con DNCP"}
        </Button>
        <Button
          variant="danger"
          disabled={busy}
          onClick={async () => {
            if (!confirm("¿Dejar de seguir esta licitación? Se borra de tu lista (no de la DNCP).")) return;
            setBusy(true);
            const res = await dejarDeSeguirLicitacion(id);
            setBusy(false);
            if (res.error) setError(res.error);
            else router.push("/licitaciones");
          }}
        >
          Dejar de seguir
        </Button>
      </div>
      {error ? <span className="text-[11px] text-[var(--error)]">{error}</span> : null}
    </div>
  );
}
