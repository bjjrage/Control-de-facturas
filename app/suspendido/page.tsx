import { logout } from "@/app/(internal)/actions";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Cuenta suspendida · niupack" };

export default function SuspendidoPage() {
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <h1 className="text-[17px] font-semibold mb-2">Cuenta suspendida</h1>
        <p className="text-[13px] text-[var(--muted)] mb-5">
          El acceso de tu empresa está desactivado por el momento. Si creés que es un error,
          contactá al administrador del sistema.
        </p>
        <form action={logout}>
          <Button type="submit" variant="secondary">
            Cerrar sesión
          </Button>
        </form>
      </div>
    </div>
  );
}
