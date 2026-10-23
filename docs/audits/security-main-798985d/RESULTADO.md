# Resultado de las correcciones de seguridad

Fecha: 22/10/2026. Base: `798985d355fb8ed96796237e6f198c172db98709`.
Rama local: `batch/security-main-798985d`.

**Fix implementado para SEC-01, SEC-02, SEC-03 y SEC-04, publicado en el [PR #41](https://github.com/bjjrage/Control-de-facturas/pull/41).** El candidato de código `d85bfb49a56b0420f1cb935043d2202dd0733e1e` se probó localmente contra el Supabase de QA; ambas migraciones se aplicaron allí y las nueve pruebas de integración seleccionadas pasaron. Ver [QA_RESULTADO.md](QA_RESULTADO.md) para alcance, evidencia y límites. Main y producción no se modificaron; no hubo merge, despliegue ni envíos de correo.

Ampliación posterior autorizada: se recuperó el estilo pendiente de las tarjetas del Plan Semanal sobre 0535e5a0, reutilizando el CSS original de costeo. Nuevo build/TypeScript aprobado, 85/85 tests existentes aprobados y verificación visual autenticada en QA. El backend de seguridad y las migraciones permanecen idénticos; no se incorporó la rama antigua del scanner. Evidencia y limitaciones móviles en [UI_TARJETAS_RESULTADO.md](UI_TARJETAS_RESULTADO.md).

## Cambios

| Hallazgo | Corrección |
|---|---|
| SEC-01: scanner | Propietario y contexto obligatorios; bucket fijo y ruta exacta vinculada a empresa/sesión/archivo antes de firmar o asociar el original a una factura. DML cliente revocado; lectura con RLS por rol/empresa/propiedad y grants solo de columnas de estado, sin credenciales ni metadata arbitraria. Se mantiene el escaneo general propio para comercial. |
| SEC-02: Next | Next y eslint-config-next fijados en **16.4.2**. El nuevo reporte npm ya no incluye la alerta de Next que bloqueaba este candidato. La versión fue contrastada con la [release oficial](https://github.com/vercel/next.js/releases/tag/v16.4.2). |
| SEC-03: Gmail | Actor obtenido del perfil autenticado, decisión persistida vinculada al usuario y rol vigente; aprobaciones creadas/decididas/transicionadas mediante RPC service-only. Comprobaciones del emisor y aprobador activos en claim y lectura del secreto. Se invalidan aprobaciones antiguas no verificables sin intento asociado, preservando historial e intentos existentes. |
| SEC-04: plantillas | HTML con allowlist y CSS reconstruido con parser; guardado, generación y renderizado saneados. Interpolación segura por nodos, logo validado y recursos ajenos eliminados. Preview aislado con sandbox sin scripts/mismo origen y CSP restrictiva. Se conserva CSS sencillo de impresión y A4. |

Se ajustaron los fixtures de scanner y orquestador al contrato nuevo y se agregaron negativos de propietario, ruta, rol actual y aprobaciones fabricadas. No se relajaron las protecciones para hacer pasar las pruebas.

## Verificación final

- `npm run build`: **PASS**, Next 16.4.2/Turbopack, compilación, TypeScript y generación de las 60 páginas estáticas. Se usaron únicamente valores de Supabase sintéticos de build, sin credenciales reales.
- `tsc --noEmit --incremental false`: primera verificación aprobada; el build final volvió a validar TypeScript después de todas las correcciones.
- Vitest: **274 archivos, 2.496 casos aprobados, 16 omitidos, 0 fallos pendientes** en el resultado consolidado. La primera corrida completa mostró nueve fallos en cuatro suites; los fixtures/mocks se corrigieron y las nueve suites relacionadas se repitieron con **69/69 PASS**. La suite SQL no modificada que agotó el tiempo de arranque se repitió sin cambios con **11/11 PASS**. Se conservaron los reportes iniciales y finales; no se presenta la primera corrida como aprobada.
- Migraciones ejecutadas en PostgreSQL efímero PGlite con fixtures sintéticos: ACL, RLS, columnas, autoridad de aprobación, revocación de rol, invalidación de legado y flujos válidos. Revisión independiente del SQL Gmail contra las firmas, triggers y tipos del baseline: **PASS**.
- Navegador local sin sesiones ni red: **PASS**, cero JavaScript ejecutado, cero elementos activos en impresión, cero recursos ajenos solicitados, preview sin acceso al padre y CSS A4 conservado.
- `git diff --check`: **PASS**. ESLint sobre los 25 archivos TypeScript modificados/nuevos: **cero hallazgos nuevos** frente a la base. Permanecen 44 errores y 13 warnings de los tests antiguos modificados; se confirmó con ESLint sobre su contenido exacto en `798985d` que los mismos 44/13 ya existían. No se presenta ESLint global como limpio.
- Dependencias y lockfile coherentes. `npm audit` pasó de 16 a 14 paquetes señalados y Next ya no aparece. **No se afirma que el contador de vulnerabilidades sea cero**: quedan alertas previas de herramientas de desarrollo y dependencias transitivas descritas en la auditoría original.

Evidencia local fuera del repo: `../security-fix-validation` respecto al worktree. Incluye `build.log`, `vitest-all.json`, `vitest-final-recovery.json`, `vitest-final-fixes.json`, `vitest-consolidated.json`, `template-browser-proof.json`, `dependency-verification.json` y `eslint-verification.json`.

## Migraciones aplicadas solo en QA

1. `supabase/migrations/20261022231201_scanner_session_authorization.sql`.
2. `supabase/migrations/20261022231211_sec03_gmail_approval_authority.sql`.

Ambas migraciones se aplicaron en `kyiihlkncatojvlasoag`, con versiones de historial alineadas a los archivos del repositorio. Pasaron los controles de permisos con usuarios reales, scanner con carga directa de 20 MiB, decisiones legítimas de aprobación y saneamiento de una plantilla almacenada en la ruta de impresión real. No se ejecutaron la extracción mediante proveedor IA y el guardado final de factura, OAuth/envío real de Gmail ni un worker desplegado. Estas pruebas seleccionadas no equivalen a un E2E completo de todos los procesos de negocio.

La migración de Gmail retira escrituras directas y la RPC antigua de cancelación. Su aplicación requiere una ventana coordinada con versiones compatibles de app y worker; una versión antigua puede fallar durante una actualización descoordinada. Las aprobaciones antiguas canceladas sin intento deben solicitarse otra vez. Los originales enviados y sus intentos se preservan.

## Límites

El fix no cambia planes comerciales, vistas de información pública, WAF/cuotas ni el proxy de voz independiente cuya exposición no se confirmó. Tampoco reabre esos puntos como bloqueantes sin nueva evidencia. El CSS complejo o recursos externos de plantillas se eliminan deliberadamente y pueden requerir ajuste de formato en QA.

Los checkouts originales y sus archivos pendientes quedaron preservados. No se mezclaron otras ramas. Este resultado cierra la implementación y la validación seleccionada en QA; **el riesgo de producción solo queda corregido allí cuando se autorice y complete el despliegue coordinado**.
