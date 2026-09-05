"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { deleteProject } from "./actions";

export function ProjectRowActions({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const confirmed = window.confirm(
      `¿Eliminar la obra "${projectName}"? Se borran también su presupuesto, avances, compras vinculadas y todo lo cargado. Esta acción no se puede deshacer.`
    );
    if (!confirmed) return;
    setPending(true);
    const result = await deleteProject(projectId);
    setPending(false);
    if (result.error) {
      alert(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
      <Link
        href={`/projects/${projectId}`}
        title="Editar obra"
        className="inline-flex items-center justify-center h-7 w-7 rounded-md text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--foreground)]"
      >
        <Pencil size={14} />
      </Link>
      <button
        type="button"
        title="Eliminar obra"
        disabled={pending}
        onClick={handleDelete}
        className="inline-flex items-center justify-center h-7 w-7 rounded-md text-[var(--error)] hover:bg-[var(--error-bg)] disabled:opacity-50"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
