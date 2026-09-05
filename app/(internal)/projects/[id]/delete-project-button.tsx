"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteProject } from "../actions";

export function DeleteProjectButton({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleDelete() {
    const confirmed = window.confirm(
      `¿Eliminar la obra "${projectName}"? Se borran también su presupuesto, avances, compras vinculadas y todo lo cargado. Esta acción no se puede deshacer.`
    );
    if (!confirmed) return;
    setPending(true);
    const result = await deleteProject(projectId);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.push("/projects");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      {error ? <span className="text-[12px] text-[var(--error)]">{error}</span> : null}
      <Button variant="ghost" onClick={handleDelete} disabled={pending} title="Eliminar obra">
        <Trash2 size={15} className="text-[var(--error)]" />
      </Button>
    </div>
  );
}
