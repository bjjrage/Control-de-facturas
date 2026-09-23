import type { EmailConnectionSummary } from "@/lib/email/types";

export function EmailIntegration({ connection }: { connection: EmailConnectionSummary | null }) {
  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 space-y-3">
      <div>
        <h2 className="text-[15px] font-semibold">Correo de Rodrigo</h2>
        <p className="text-[13px] text-[var(--muted)] mt-1">
          Conectá una cuenta Gmail para que Rodrigo prepare correos y los envíe solamente después de tu aprobación.
          Solo se solicita el permiso mínimo de envío.
        </p>
      </div>
      {connection ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] px-3 py-2">
          <div className="min-w-0">
            <p className="text-[13px] font-medium truncate">{connection.providerEmail ?? "Cuenta Gmail conectada"}</p>
            <p className="text-[12px] text-[var(--muted)]">Estado: conectada</p>
          </div>
          <form action="/api/integrations/gmail/disconnect" method="post">
            <button
              type="submit"
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-[12px] hover:bg-[var(--muted-bg)]"
            >
              Desconectar
            </button>
          </form>
        </div>
      ) : (
        <a
          href="/api/integrations/gmail/connect"
          className="inline-flex rounded-md bg-[var(--accent)] px-3 py-2 text-[13px] font-medium text-white hover:opacity-90"
        >
          Conectar Gmail
        </a>
      )}
    </section>
  );
}
