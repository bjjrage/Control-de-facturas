# Correcciones previas a beta — 22/10/2026

Base evaluada: `main` `ec090593c647daa928e59a188428f334152ba75a` más las correcciones locales descritas aquí. Checkout de trabajo: `C:\e2e-main`. Producción permanece en `ec090593`. No se hizo push ni deploy.

El usuario autorizó expresamente una excepción puntual a `GIT-FREEZE-POLICY.md` para guardar estas correcciones en exactamente cuatro commits locales sobre `main`. El ajuste del hook se limita a esas invocaciones; la configuración permanente `.githooks` y la protección de push se conservan.

## A1–A7

| Caso | Cambio | Evidencia |
|---|---|---|
| A1 | RLS restrictiva por empresa y rol en cuentas, movimientos y gastos recurrentes | `rls-results.json`: comercial, otra empresa y anónimo ven cero; administración y admin conservan acceso. El RPC `cashflow_read_sources` rechaza comercial/anónimo con `42501` y limita admin/administración a su empresa, incluido admin B. Las operaciones de tesorería ya tienen guardas de rol/empresa. |
| A2 | Trigger de cantidad acumulada y nueva verificación al elaborar; cantidades finitas; refresco de importes y restauración del campo rechazado | 6 regresiones PostgreSQL compartidas con A4 y navegador: 105/100 rechazado, 10/100 guardado y actualizado. Dos borradores concurrentes y anterior adulterado se revalidan. |
| A3 | Borrador del certificado redirige a `/ventas/<id>` | Navegador: generar → elaborar → verificar → aprobar → crear factura → abrir su detalle sin 404. |
| A4 | RUC normalizado único por empresa; mensaje claro | Índice y trigger, regresiones PostgreSQL y navegador. Los duplicados históricos conservan IDs y vínculos; una marca interna permite conservarlos, sin permitir nuevas identidades duplicadas. |
| A5 | Bloqueo sincrónico del envío, formulario limpio y mensaje de éxito | Navegador: doble clic produce exactamente un movimiento de cantidad 7; formulario vacío, estado de éxito y botón deshabilitado. Se conserva la idempotencia durable existente. |
| A6 | Cancelación autenticada y por propietario; revocación de credencial móvil, PIN y QR; PIN HMAC y generación criptográfica | Navegador conectado por PIN: cancelar, confirmar estado `canceled`, PIN retirado, credencial nula y nuevo claim rechazado; cancelar otra vez es idempotente. 48 regresiones de scanner/certificado aprobadas. |
| A7 | `is_cheapest` compara cesta de mismas líneas/cantidades/moneda con impuestos y flete; motivo humano preservado | 4 regresiones PostgreSQL: precio, flete, moneda y cantidad disponible. `rfq-qa-results.json`: dos OC reales de QA verifican que el precio unitario menor no basta si el flete encarece el total. |

Migraciones creadas con la CLI y aplicadas exclusivamente a QA `kyiihlkncatojvlasoag`:

- `20261022022722_beta_treasury_role_boundaries.sql`
- `20261022022745_beta_certificate_quantity_cap.sql`
- `20261022022747_beta_provider_tax_identity.sql`
- `20261022023246_beta_scanner_pin_storage.sql`
- `20261022023248_beta_rfq_order_selection_metadata.sql`

QA tiene 83 migraciones y producción 79. QA no tiene `20261013153336_fix_accept_quotation_ot_code`; producción sí. No se alteraron los certificados históricos ya sobrecertificados ni se recalcularon OC anteriores. En QA se conservaron 11 proveedores históricos con el RUC duplicado: uno canónico y diez marcados como históricos.

El futuro despliegue de scanner debe coordinar migración y código: la migración invalida las sesiones temporales anteriores y exige emitir PIN nuevo. El código anterior escribe PIN en claro y es incompatible con el CHECK nuevo. HMAC usa la clave de servicio existente, solo en servidor; rotarla también requiere regenerar las sesiones activas. No se cambió ninguna clave.

## Validación

- Build local de producción con Next 16.3.8: aprobado (`next build --webpack`).
- TypeScript: `tsc --noEmit --incremental false`.
- Suite completa en serie: **267 archivos aprobados, 2 omitidos; 2.467 pruebas aprobadas, 16 omitidas**.
- La primera corrida paralela tuvo timeouts de fixtures PostgreSQL y tests de scanner sin la clave HMAC de prueba. Se adaptaron las fixtures, sin cambiar las comprobaciones de seguridad; la ejecución completa en serie pasó.
- Cuatro flujos de navegador contra el build de producción local y Supabase QA, más lectura RLS y dos adjudicaciones RFQ reales. Los artefactos privados completos están en `.qa/beta-*`; la evidencia versionada no contiene claves, cookies ni PIN.
- Al cerrar el navegador Next registra `The destination stream closed early`. El resultado de Playwright conserva cero fallos; se comprobó por separado su código nativo `0` en el flujo completo de certificado. PowerShell 5 convierte ese stderr redirigido en un registro de error aunque el proceso termine correctamente.
- ESLint de archivos nuevos: sin errores. Persisten seis errores anteriores y dos advertencias en los archivos de runtime inspeccionados (refs/efecto de scanner, dos usos de `any` e imagen). Se comprobaron contra el código base; no se presenta el lint global como aprobado.

Los tests de navegador generan entidades `QA Beta ...` y fechas de certificado 2035. Las OC y movimientos de QA se conservan como evidencia por sus restricciones de inmutabilidad. Los repros no envían correos ni cambian producción.

## B — IA

Ver [matriz de modelos](model-matrix.md) y [resultados por campo, tokens y latencia](model-evaluation.json). Son 42 solicitudes reales sobre 14 documentos sintéticos. Luna y Sol pasan los campos puntuados en 14/14; el lector actual en 13/14. Los costos calculados son USD 0,004746 para Luna, 0,087456 para Sol y 0,048021 para la línea base. Incluyen consumo medido y lectura/escritura de caché a tarifa estándar; no están conciliados con una factura del proveedor.

**No se cambia el lector.** C06 es una factura sintética rasterizada; faltan documentos reales, manuscritos y varias páginas revisados por una persona, negativos de negocio completos y los recorridos 15/16/17 con el candidato integrado tanto en app como en worker. La prueba puntúa un conjunto explícito de campos, no toda la salida textual. La aritmética inconsistente se transcribe; la aprobación de negocio sigue dependiendo de validaciones deterministas.

Luna sigue como candidato preferido para completar QA. Sol no aportó mejoras adicionales en esta muestra para justificar habilitar segunda lectura. `invoice-extraction.ts` permanece con `gpt-4o-mini` en texto/fotos y `gpt-4o` para PDF escaneado. Matching de ítems, certificados y analista operacional usan mini; plantillas usan 4o; no se modificaron.

## C — Producción, solo lectura

- Vercel `control-de-facturas`: despliegue `dpl_EiQ6cpNY8emtWu9VjkGQHGa4xHVZ`, `READY`, `main` `ec090593`, alias principal conservado. `OPENAI_API_KEY` existe para producción y es sensible; no se leyó su valor. No hay variables `GOEKUA_*` de producción.
- Railway: conector y CLI requieren reautenticación. La última evidencia del release del 20/10 informa worker `ec090593` exitoso; **su estado actual queda pendiente**, al igual que la presencia actual de la clave y el acceso/saldo del modelo con esa clave de producción.
- Supabase producción: 79 migraciones, ninguna beta, fix de `accept_quotation` presente. Las 27 funciones comprobadas del release existen: 12 coinciden con su fuente; 14 corresponden exactamente a la fuente con una transformación histórica de codificación; `inventory_confirm_receipt` coincide al normalizar la codificación de sus mensajes. No se detectaron diferencias lógicas en esa comparación. No se corrigió esa codificación en producción.
- Respaldo anterior localizado, previo al release del 20/10, 01:40 UTC. No se afirma que sea actual ni que se haya probado su restauración. Requiere actualización/verificación antes de cargar datos reales.
- Falta la factura real de la usuaria beta. Si necesita emisión electrónica real, contratar/configurar Goekua/SIFEN sigue siendo bloqueante.

## Reproducir

Preparar `.env.local` exclusivamente de QA y `.qa/users.json` con `admin_a`, `administracion_a`, `comercial_a` y `admin_b` (cada entrada con `email`, `id`, `empresa_id`), y `E2E_PASSWORD`. No versionar credenciales ni estados de sesión. Los scripts verifican el host exacto de QA; Playwright usa exclusivamente localhost:3028.

```powershell
node node_modules/vitest/vitest.mjs run --maxWorkers=1 --no-file-parallelism
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/next/dist/bin/next build --webpack
$env:ALLOW_EXTERNAL_TEST_DB='true'
node node_modules/@playwright/test/cli.js test --config playwright.beta.config.ts
node scripts/qa/beta/verify-rls.cjs
node scripts/qa/beta/verify-rfq-qa.cjs
node scripts/qa/beta/evaluate-models.cjs
node scripts/qa/beta/report-models.cjs
```

La evaluación de modelos usa la clave QA y tiene costo. El adaptador Responses existe solo dentro del arnés, reutiliza extractor/prompts/esquema, no sustituye el transporte de la app. `store:false`, esfuerzo `medium` en candidatos y cero reintentos. El JSON registra hash del extractor, entradas y prompts, modelos efectivos, salidas, diferencias y uso. El script RFQ crea dos adjudicaciones y PDFs de QA por ejecución.
