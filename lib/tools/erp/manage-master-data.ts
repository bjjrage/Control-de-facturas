import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { actionResult, toFormData } from "./action-utils";

const fieldsSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  code: z.string().trim().min(1).max(80).optional(),
  tax_id: z.string().trim().max(80).optional().nullable(),
  contact_name: z.string().trim().max(200).optional().nullable(),
  email: z.string().trim().email().optional().nullable(),
  phone: z.string().trim().max(80).optional().nullable(),
  address: z.string().trim().max(500).optional().nullable(),
  payment_terms: z.string().trim().max(200).optional().nullable(),
  client: z.string().trim().max(200).optional().nullable(),
  location: z.string().trim().max(500).optional().nullable(),
  start_date: z.string().trim().max(30).optional().nullable(),
  end_date: z.string().trim().max(30).optional().nullable(),
  budget_total: z.number().finite().nonnegative().optional(),
  status: z.enum(["ACTIVO", "PAUSADO", "COMPLETADO", "CANCELADO"]).optional(),
});

export const ManageMasterDataInputSchema = z.object({
  entity: z.enum(["client", "provider", "project"]),
  operation: z.enum(["create", "update", "activate", "deactivate", "update_status"]),
  id: z.string().uuid().optional(),
  fields: fieldsSchema.default({}),
});
export type ManageMasterDataInput = z.infer<typeof ManageMasterDataInputSchema>;

async function handler(
  _ctx: AgentToolContext,
  input: ManageMasterDataInput,
  _deps: { db: SupabaseClient },
) {
  const id = input.id;
  const fields = input.fields;
  if (input.operation !== "create" && !id) throw new Error("La operación necesita una entidad resuelta.");
  if (input.operation === "create" && input.entity === "project" && (!fields.name || !fields.code)) {
    throw new Error("Para crear una obra hacen falta nombre y código.");
  }
  if (input.operation === "create" && input.entity !== "project" && !fields.name) {
    throw new Error("Para crear el registro hace falta nombre.");
  }

  let result: unknown;
  if (input.entity === "client") {
    const actions = await import("@/app/(internal)/clientes/actions");
    if (input.operation === "create") result = await actions.createClientRecord(toFormData(fields));
    else if (input.operation === "update") result = await actions.updateClientRecord(id!, toFormData(fields));
    else if (input.operation === "activate" || input.operation === "deactivate") result = await actions.toggleClientActive(id!, input.operation === "activate");
    else throw new Error("Los clientes no tienen cambio de estado operativo separado.");
  } else if (input.entity === "provider") {
    const actions = await import("@/app/(internal)/providers/actions");
    if (input.operation === "create") result = await actions.createProvider(toFormData(fields));
    else if (input.operation === "update") result = await actions.updateProvider(id!, toFormData(fields));
    else if (input.operation === "activate" || input.operation === "deactivate") result = await actions.toggleProviderActive(id!, input.operation === "activate");
    else throw new Error("Los proveedores no tienen cambio de estado operativo separado.");
  } else {
    const actions = await import("@/app/(internal)/projects/actions");
    if (input.operation === "create") result = await actions.createProject(toFormData(fields));
    else if (input.operation === "update") result = await actions.updateProject(id!, toFormData(fields));
    else if (input.operation === "update_status") {
      if (!fields.status) throw new Error("Para cambiar el estado hace falta status.");
      result = await actions.updateProjectStatus(id!, fields.status);
    } else throw new Error("Las obras solo admiten crear, editar o cambiar de estado.");
  }

  return { entity: input.entity, operation: input.operation, id: id ?? null, ...actionResult(result), message: "Operación del ERP ejecutada." };
}

registerTool<ManageMasterDataInput, Record<string, unknown>>({
  name: "manage_master_data",
  description: "Crea o edita clientes, proveedores y obras usando las acciones reales del ERP. Antes de update/activate/deactivate/update_status resolvé la entidad por nombre; requiere aprobación.",
  inputSchema: ManageMasterDataInputSchema,
  riskLevel: 2,
  requiredRoles: null,
  handler,
});

export const manageMasterDataTool = { handler, inputSchema: ManageMasterDataInputSchema };
