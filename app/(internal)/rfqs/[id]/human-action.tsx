"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function HumanAction({
  label,
  confirmation,
  action,
}: {
  label: string;
  confirmation?: string;
  action: (confirmed: boolean) => Promise<{ error: string | null }>;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div className="space-y-2">
      {confirmation && (
        <label className="block">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />{" "}
          {confirmation}
        </label>
      )}
      <Button
        variant="secondary"
        disabled={pending || (!!confirmation && !confirmed)}
        onClick={async () => {
          setPending(true);
          setError(null);
          try {
            const result = await action(confirmed);
            if (result.error) setError(result.error);
            else router.refresh();
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "No se pudo completar la acción",
            );
          } finally {
            setPending(false);
          }
        }}
      >
        {pending ? "Procesando…" : label}
      </Button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
