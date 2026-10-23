import { z } from "zod";

export const empresaPlanSchema = z.enum(["basico", "pro", "caterpillar"]);
export const empresaAccessSchema = z.object({
  plan: empresaPlanSchema,
  modulo_compras: z.boolean(),
  modulo_ventas: z.boolean(),
});
export type EmpresaAccess = z.infer<typeof empresaAccessSchema>;

export function accessFromForm(formData: FormData) {
  return empresaAccessSchema.safeParse({
    plan: formData.get("plan"),
    modulo_compras: formData.get("modulo_compras") === "on",
    modulo_ventas: formData.get("modulo_ventas") === "on",
  });
}
