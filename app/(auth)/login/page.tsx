import Image from "next/image";
import { login } from "./actions";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] px-4">
      <div className="w-full max-w-[340px]">
        <div className="mb-6 flex justify-start">
          <Image src="/logo/niupack-wordmark.svg" alt="niupack" width={120} height={26} priority />
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5">
          <h1 className="text-[15px] font-semibold mb-0.5">Control de Facturas</h1>
          <p className="text-[12px] text-[var(--muted)] mb-4">Ingresá con tu cuenta interna</p>
          {params?.error ? (
            <div className="mb-3 rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
              {params.error}
            </div>
          ) : null}
          <form
            action={async (formData: FormData) => {
              "use server";
              const result = await login(formData);
              if (result?.error) {
                const { redirect } = await import("next/navigation");
                redirect(`/login?error=${encodeURIComponent(result.error)}`);
              }
            }}
            className="space-y-3"
          >
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required autoFocus />
            </div>
            <div>
              <Label htmlFor="password">Contraseña</Label>
              <Input id="password" name="password" type="password" required />
            </div>
            <Button type="submit" className="w-full">
              Ingresar
            </Button>
          </form>
        </div>
        <p className="mt-3 text-[11px] text-[var(--muted)]">
          Panel interno · uso exclusivo del personal de niupack
        </p>
      </div>
    </div>
  );
}
