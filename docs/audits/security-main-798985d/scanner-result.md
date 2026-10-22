# SEC-01 — Control de sesiones Scanner

Base del arreglo: `798985d355fb8ed96796237e6f198c172db98709`. Migración nueva: `supabase/migrations/20261022231201_scanner_session_authorization.sql`.

## Cambio aplicado en el worktree

- `scan_sessions` conserva RLS y reemplaza las policies permisivas de tenant por lectura del mismo tenant: `admin` y `administracion` pueden leer estado seguro del tenant; `comercial` solo sesiones `general` propias. Se revocaron los privilegios directos de `INSERT`, `UPDATE` y `DELETE` a `anon` y `authenticated`; `service_role` conserva sus escrituras y las ACL existentes de RPC no se modifican.
- `authenticated` recibe SELECT por columna para estado/contexto y referencias no secretas. No puede leer `token_hash`, `pin_code`, `mobile_claim_token_hash`, `claimed_device_info` ni `metadata`. El tool `get_scanner_session_overview` ya no solicita JSON arbitrario de metadata y devuelve `metadata_available: null` para indicar que ese dato no está disponible.
- Crear contexto `general` sigue disponible para los tres roles de la app. Crear/leer contexto `invoice` requiere `admin` o `administracion`; las sesiones de status además deben pertenecer al usuario que consulta, incluso si es administrador.
- El endpoint de status solo firma objetos del bucket fijo `invoice-files` con ruta exacta `${empresa_id}/scans/${session.id}/${sanitizeFileName(file_name)}`. Rutas manipuladas, bucket inesperado o referencias incompletas devuelven 409 sin firmar.
- Upload rechaza sesiones con bucket distinto al fijo. La acción de crear factura revalida creador, contexto, bucket y ruta antes de descargar el original del scanner.
- La tabla sigue en `supabase_realtime`; no se encontraron suscripciones `postgres_changes` a `scan_sessions` en el código activo (la suscripción existente observada es a `invoice_jobs`). Las columnas seguras siguen disponibles a consultas/realtime explícitos con RLS, mientras una selección wildcard queda impedida por privilegios de columna.

## Verificación local

- `lib/scanner/__tests__/session-authorization-db.spec.ts`: 3 pruebas; aplica la migración en PGlite efímero sobre roles, RLS y grants de fixture. Verifica filas por tenant/rol/propietario, lectura de columnas permitidas, denegación de columnas secretas y de escrituras directas `anon`/`authenticated`, y escrituras/RPC disponibles para `service_role`.
- `lib/scanner/__tests__/status-route.spec.ts`: 9 pruebas HTTP sobre status admin, sesión general comercial válida, comercial en factura, tenant/creador ajenos, ruta/bucket manipulados y creación general comercial frente a contexto factura.
- `lib/scanner/__tests__/session-service.spec.ts`: 17 pruebas de regresión del ciclo del servicio existente.
- `lib/tools/erp/__tests__/erp-tools.spec.ts`: 6 pruebas de regresión de herramientas ERP, incluida la whitelist del overview.
- Resultado conjunto: 29 pruebas scanner y 6 de overview pasaron; ESLint pasó para los archivos modificados del scope Scanner.
- El trabajo no aplicó migraciones ni consultó datos de negocio de producción o QA.

## Límite de verificación

PGlite y mocks HTTP verifican la migración y las decisiones locales; no reemplazan un despliegue ni validan la configuración viva de Realtime de cada ambiente. La migración queda pendiente de revisión y aplicación controlada por el coordinador.
