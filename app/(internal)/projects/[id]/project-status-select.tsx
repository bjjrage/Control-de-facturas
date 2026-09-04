"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/input";
import { ProjectStatus } from "@/lib/types";
import { updateProjectStatus } from "../actions";

const OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: "ACTIVO", label: "Activo" },
  { value: "PAUSADO", label: "Pausado" },
  { value: "COMPLETADO", label: "Completado" },
  { value: "CANCELADO", label: "Cancelado" },
];

export function ProjectStatusSelect({ projectId, status }: { projectId: string; status: ProjectStatus }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="flex items-center gap-2">
      <Select
        value={status}
        disabled={pending}
        className="h-7 text-[12px] w-auto"
        onChange={(e) => {
          const next = e.target.value as ProjectStatus;
          startTransition(async () => {
            const result = await updateProjectStatus(projectId, next);
            if (result.error) setError(result.error);
            else {
              setError(null);
              router.refresh();
            }
          });
        }}
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </Select>
      {error ? <span className="text-[11px] text-[var(--error)]">{error}</span> : null}
    </div>
  );
}
