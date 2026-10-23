import { Label, Select } from "@/components/ui/input";
import type { EmpresaAccess } from "@/lib/empresas/access";

export function EmpresaAccessFields({ prefix, access = { plan: "basico", modulo_compras: true, modulo_ventas: false }, disabled = false }: { prefix: string; access?: EmpresaAccess; disabled?: boolean }) {
  return (
    <fieldset disabled={disabled} className="flex flex-wrap items-end gap-3">
      <div className="min-w-36 flex-1">
        <Label htmlFor={`${prefix}-plan`}>Plan</Label>
        <Select id={`${prefix}-plan`} name="plan" defaultValue={access.plan} required>
          <option value="basico">Básico</option><option value="pro">Pro</option><option value="caterpillar">Caterpillar</option>
        </Select>
      </div>
      <label className="flex items-center gap-2 py-2 text-[13px]"><input type="checkbox" name="modulo_compras" defaultChecked={access.modulo_compras} />Compras</label>
      <label className="flex items-center gap-2 py-2 text-[13px]"><input type="checkbox" name="modulo_ventas" defaultChecked={access.modulo_ventas} />Ventas</label>
    </fieldset>
  );
}
