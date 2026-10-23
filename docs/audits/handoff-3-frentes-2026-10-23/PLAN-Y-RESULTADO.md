# Tres frentes: versión estable, navegación y administración

Fecha: 2026-10-23. Base: main c027ec23. Estado: implementación local validada; publicación de código, migración productiva y promoción pendientes.

## Alcance acordado

- Trabajo en el checkout existente de main, C:\e2e-main. Sin ramas ni worktrees nuevos.
- C: únicamente autoAssignCustomDomains=false en control-de-facturas, autorizado expresamente por el usuario. El alias estable debe conservar c027ec23. No promover otra versión ni invitar usuarios todavía.
- B: validación de claims, perfil activo consultado en cada petición, precarga con permisos para Proyectos/Materiales/Inventario, consultas independientes en paralelo y esqueletos de carga. Medición local con build de producción y backend QA antes/después.
- A: administración de usuarios limitada a la empresa, guardas contra autoexclusión/último administrador/superadmin, eliminación con control de operaciones vinculadas. Plan y módulos por empresa solo para superadmin, incluida protección en la base de datos.
- Migraciones aditivas y compatibles con c027ec23. Aplicación y pruebas primero en QA kyiihlkncatojvlasoag. Producción de datos queda sin modificar durante la preparación.
- Preservar los 227 archivos previos del E2E, sin incluirlos en los commits. Excluidos todos los proyectos y ramas históricos indicados por el usuario.
- No modificar scanner, migraciones de seguridad ya aplicadas ni configuración permanente de protección de main.

## C: versión estable comprobada

El cambio autorizado autoAssignCustomDomains=false fue aceptado por la API de Vercel. Se publicó únicamente el commit documental 143785a720dae87217353a084782cfc337ba5320 mediante la excepción puntual autorizada por el usuario. La protección completa de main se restauró inmediatamente y su snapshot coincide con el previo; enforce_admins=true. La ventana de excepción registrada fue de 04:36:48 a 04:36:57 UTC.

El build dpl_FAw3X73BDwEwPok7CFf7xVJ6g633 terminó READY para 143785a en gru1. Después de terminar:

- URL estable: https://control-de-facturas-bay.vercel.app → dpl_DQAx9nooqPdtGCiu9H1EfDAEMLfV → c027ec23.
- URL de main más reciente: https://control-de-facturas-marceloechauri-4623s-projects.vercel.app → dpl_FAw3X73BDwEwPok7CFf7xVJ6g633 → 143785a.
- El GET público de /login en la URL estable devolvió 200 y x-vercel-id gru1::gru1. La URL única del build nuevo devolvió 403 de protección de Vercel, también mediante su fetch autenticado; no se modificó esa protección. El estado READY/SHA y las asignaciones se comprobaron mediante API.

La prueba real confirma que un push a main genera un build nuevo sin mover la URL estable bay. Los otros alias de main siguen el build reciente; no deben presentarse como la URL fija.

## B: navegación y mediciones

getCurrentProfile usa getClaims verificado, mantiene cache() por petición y consulta el perfil/empresa en la base en cada petición. Los permisos nunca se toman de user_metadata. proxy.ts conserva getUser(). Con firmas simétricas el SDK puede consultar Auth como fallback: no se promete eliminar siempre una llamada de red.

Proyectos, Materiales (/stock) e Inventario físico (/inventario) comparten el mismo renderer entre carga inicial y shell. La precarga respeta rol, plan y módulo Compras. La ruta mantiene sus datos visibles durante la actualización; las respuestas de precarga no activan pantallas. Se agregaron esqueletos de carga y se encadenaron las consultas dependientes de proyectos sin esperar las lecturas independientes de materiales/stock.

Medianas de tres muestras, build de producción local con el mismo administrador y backend QA. Se descarta la primera carga de calentamiento. Datos crudos: mediciones.json.

| Operación | Antes | Candidato final |
| --- | ---: | ---: |
| Cambio precargado a Proyectos | 1.128 ms | 271 ms |
| Carga completa Proyectos | 818 ms | 844 ms |
| Carga completa Materiales | 774 ms | 689 ms |
| Carga completa Inventario | 718 ms | 634 ms |

La mejora principal es el cambio de sección (~76% menos tiempo). Las cargas completas tienen variabilidad y no muestran la misma mejora. Estas cifras son locales con QA; falta medir el candidato alojado antes de aprobar su promoción. No se reprodujo la navegación espontánea a dashboard en la prueba final: historial y salida al instructivo permanecen en la ruta elegida.

## A: usuarios, planes y base de datos

El admin administra únicamente los usuarios de su empresa: cambios de rol/estado y eliminación con confirmación. Se protegen su propia cuenta, los perfiles superadmin y el último administrador activo. Las operaciones vinculadas impiden borrar y muestran la alternativa de desactivar. Se comprueba el resultado de eliminar la cuenta en Auth; un fallo parcial no se informa como éxito. Reset de contraseña de tenant, opcional en el handoff, no se agregó.

/empresas permite al superadmin elegir plan y módulos al crear y editar cada empresa. El admin de empresa no puede cambiar el plan desde la UI, una Server Action ni REST autenticado.

La migración aditiva 20261023041952_tenant_user_management_guards.sql agrega triggers SECURITY INVOKER con search_path vacío para plan/módulos, autoexclusión y continuidad del último administrador. Las bajas concurrentes se serializan por empresa. Se aplicó únicamente en QA kyiihlkncatojvlasoag; no modifica tablas ni borra datos. Debe aplicarse en producción antes de publicar el nuevo código para conservar también allí la protección concurrente.

La consulta de solo lectura de producción confirmó que scanner_session_authorization y sec03_gmail_approval_authority ya están aplicadas. No se repitieron. La nueva migración de usuarios/planes aún no figura en producción.

## Pruebas y evidencia

- Build Next.js 16.4.2 con TypeScript: PASS. tsc --noEmit: PASS. Lint de todo el alcance: PASS.
- Suite completa: 2.524 PASS, 16 omitidas, cero fallos; dos workers y timeout de hooks de 30 s para PGlite. El paralelismo predeterminado provocó contención; no se cambió la configuración permanente de tests.
- QA de usuarios/planes: 5/5 PASS. Incluye mismo tenant, intento de otro tenant, autoexclusión, superadmin protegido, usuario con operaciones, alta/baja sin operaciones y bloqueo de su sesión previa, acceso a /empresas denegado al admin normal, plan/módulos desde la UI de superadmin y prohibición mediante REST.
- Concurrencia real en QA: de dos desactivaciones simultáneas de administradores, una fue aceptada y otra rechazada; quedó exactamente un administrador activo.
- Navegador de navegación/historial: 1/1 PASS.
- Instructivo: 5/5 PASS; 34 prácticas y 102 pasos, sin escrituras de negocio, persistencia/filtros/teclado/móvil/documentos y acceso anónimo. Se corrigieron dos selectores nativos preexistentes que incumplían el contrato global de Select.
- Advisors de QA antes/después: sin hallazgos nuevos. Se conservaron los hallazgos previos de ese entorno (incluidas dos vistas SECURITY DEFINER); esta comparación no es una nueva auditoría completa de producción.
- Se limpiaron los fixtures de las tres ejecuciones de QA: 7 empresas, 19 IDs de Auth y 1 evento ficticio. Consulta final: cero perfiles, cuentas o empresas de esos fixtures. El conector falló al borrar; la limpieza acotada se completó con CLI apuntando explícitamente a QA.
- Los 227 archivos previos de E2E se preservan por SHA-256 y quedan fuera de los commits.

Evidencia local: C:\Users\User\.codex\visualizations\2026\10\19\01a15661-d283-71a1-8bb1-f00bf370a953\handoff-3-frentes-2026-10-23. No contiene secretos en los archivos versionados del informe.

## Commits y siguiente paso

- ff70694c: navegación, claims, consultas y precarga.
- b2edeee3: usuarios/planes y migración QA.
- 125d9050: selectores comunes del instructivo.
- Publicado: únicamente 143785a documental. Los commits anteriores permanecen locales en main hasta autorizar su publicación mediante una nueva excepción puntual a la protección remota.

Antes de publicar el candidato: aplicar únicamente la migración nueva compatible en Supabase productivo y hacer el push exacto del candidato con restauración inmediata de protección. Esto requiere autorización adicional porque la última excepción estaba expresamente limitada a 143785a. El dominio estable bay debe conservar c027ec23 durante esa validación.

Después: revisar la versión alojada con el usuario, aprobar su promoción y acordar empresa, email y plan/módulos de la hermana. No se crearon todavía sus accesos.

## Promoción manual

Solo después de aprobar el candidato y sus mediciones: en Vercel > control-de-facturas > Deployments, abrir el deployment exacto probado y elegir Promote to Production. Verificar que el alias estable apunta a ese ID/SHA y volver a comprobar la asignación automática antes de otro push. La promoción no está autorizada en esta etapa.

Referencia: https://vercel.com/docs/deployments/promoting-a-deployment
