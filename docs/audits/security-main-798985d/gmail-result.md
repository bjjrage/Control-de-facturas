# SEC03 Gmail: autoridad de aprobación y envío

**Resultado:** corrección implementada en la rama `batch/security-main-798985d`, partiendo de `798985d355fb8ed96796237e6f198c172db98709`. No se aplicó ninguna migración remota ni se desplegó la aplicación. La producción sigue en `ec09059`, según el contexto del encargo.

## Hallazgo confirmado

**SEC03 — Media / P2 en la auditoría consolidada; bloqueante del flujo Gmail bajo sus precondiciones.** Antes de esta migración, los permisos/políticas de `agent_approvals` permitían a un usuario autenticado escribir estados de aprobación desde Data API. Además, el consumidor `processApprovalDecidedEvent` podía recibir identidad/tenant/rol del evento y no vinculaba la decisión con el perfil autenticado actual. Eso permitía falsificar una aprobación y alimentar la ruta de ejecución de `send_email`; la posibilidad de salida dependía de que el envío llegara a reclamar la aprobación y de que hubiera una conexión Gmail activa del usuario. La coordinación de despliegue de esta corrección es un requisito operativo separado de su severidad.

La evidencia y el cierre están en:

- `supabase/migrations/20261022231211_sec03_gmail_approval_authority.sql:457` revoca escrituras autenticadas en `agent_approvals` y conserva lectura sujeta a RLS. Las RPC de ciclo de vida son `SECURITY DEFINER` con `search_path` vacío y ejecución solo para `service_role` (`:5`, `:88`, `:146`, `:171`, `:212`, `:255`, `:413`, `:466`).
- `app/(internal)/agent/approval-actions.ts:295` obtiene el perfil actual y descarta del evento cualquier identidad aportada por el caller; exige tenant, estado y `decided_by` coincidentes antes de ejecutar (`:302–317`).
- `lib/agent/approvals.ts:65` crea aprobaciones únicamente por RPC de servidor; `:115` delega la decisión con el actor, tenant y roles actuales. El módulo marca su frontera de servidor en `:6`.
- La RPC de decisión verifica membresía activa, empresa activa, rol vigente, estado REQUESTED y el rol permitido para correo (`supabase/migrations/20261022231211_sec03_gmail_approval_authority.sql:113–142`). El claim comprueba nuevamente que emisor y aprobador sigan activos y autorizados en el punto de envío (`:278–347`); la lectura de secreto OAuth vuelve a comprobarlos antes de devolverlo (`:411–454`).
- Los registros legados `send_email` REQUESTED/APPROVED/EXECUTING sin intento asociado se cancelan y sus drafts WAITING_APPROVAL vuelven a READY, para pedir una decisión nueva (`:390–409`). Se preservan los intentos ya creados y el historial de envíos.

La cancelación del draft usa ahora una RPC de tres argumentos, valida el actor/empresa/rol vigente y elimina la sobrecarga anterior de dos argumentos. Las llamadas de dominio pasan por esta RPC en `lib/email/domain-service.ts:34` y la acción de servidor en `app/(internal)/agent/approval-actions.ts:235`.

## Verificación

- Vitest focalizado: **7 archivos, 46 pruebas aprobadas**: aprobación y ejecución, acciones con actor forjado, gateway, helpers de aprobación, contrato SQL en PGlite, hardening de Gmail y orquestador.
- El caso PGlite prueba rechazo de INSERT/UPDATE y RPC como `authenticated`, denegación al cambiar el rol o desactivar perfil, aprobación/claim válidos para actor autorizado, invalidación de aprobaciones pendientes legadas y preservación de intento consumido: `lib/email/__tests__/gmail-approval-authority-db.spec.ts:116–211`.
- ESLint pasó para acciones de aprobación, `approvals.ts`, `domain-service.ts`, tests nuevos de acciones/SQL y test de gateway. Al incluir `approval-execution.spec.ts`, ESLint reporta 12 errores `no-explicit-any` y 3 warnings de variables no usadas en ese archivo; sus pruebas sí pasan. `orchestrator.spec.ts` no presenta errores de lint y mantiene un warning por un helper no usado. No se reportan secretos ni datos personales en este informe.
- No se ejecutaron flujos E2E existentes, accesos cloud, envíos, pruebas contra Gmail, ni operaciones de QA o producción. La migración se verificó offline con PGlite; la aplicación contra una base real no forma parte de este resultado.

## Condición de release

Aplicar migración y desplegar aplicación/worker compatibles como una única ventana coordinada, con verificación de la versión activa de ambos consumidores. El cambio retira el acceso directo de Data API y la RPC antigua de cancelación; la aplicación/worker anteriores pueden fallar si la migración se aplica antes que sus versiones nuevas. No dejar esta corrección pendiente en producción sin esa secuencia, ni considerar el riesgo cerrado para producción antes de aplicar la migración.
