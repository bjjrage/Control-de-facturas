"use server";

import { z } from "zod";
import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createEmptyProjectWorkbook, validateProjectWorkbook } from "@/lib/projects/workspace-book";

export async function createProjectWorkspace(id: string): Promise<{ revision?: number; error: string | null }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  if (!z.string().uuid().safeParse(id).success) return { error: "El identificador del workspace no es válido." };
  const db = await createClient();
  const { error } = await db.from("project_workspaces").upsert({ id, empresa_id: profile.empresa_id, created_by: profile.id, name: "Obra sin nombre", workbook: createEmptyProjectWorkbook(id) }, { onConflict: "id", ignoreDuplicates: true });
  if (error) return { error: "No se pudo crear el workspace. Volvé a intentar guardar." };
  const { data } = await db.from("project_workspaces").select("revision").eq("id", id).eq("empresa_id", profile.empresa_id).maybeSingle();
  return data ? { revision: data.revision, error: null } : { error: "No se pudo acceder al workspace." };
}

export async function saveProjectWorkspace(id: string, expectedRevision: number, workbook: unknown): Promise<{ revision?: number; error: string | null }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  if (!z.string().uuid().safeParse(id).success || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) return { error: "La revisión del workspace no es válida." };
  const invalid = validateProjectWorkbook(workbook, id);
  if (invalid) return { error: invalid };
  const book = workbook as { name?: string };
  const name = typeof book.name === "string" ? book.name.trim() : "";
  if (!name || name.length > 200) return { error: "El nombre de la obra debe tener entre 1 y 200 caracteres." };
  const db = await createClient();
  const { data, error } = await db.from("project_workspaces").update({ name, workbook, revision: expectedRevision + 1 })
    .eq("id", id).eq("empresa_id", profile.empresa_id).eq("revision", expectedRevision).select("revision").maybeSingle();
  if (error) return { error: "No se pudo guardar el libro. Tus cambios siguen abiertos en esta pantalla." };
  if (!data) return { error: "Otra sesión cambió este libro. No se sobrescribió. Conservá esta pestaña y revisá la versión guardada en otra pestaña antes de continuar." };
  return { revision: data.revision, error: null };
}
