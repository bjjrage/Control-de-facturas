# Plan de auditoría de código y flujos E2E antes del merge

Fecha: 18/10/2026. Leer primero el [handoff del proyecto](2026-10-18-HANDOFF-E2E-CONTROL-FACTURAS.md). Candidato único: [PR #38](https://github.com/bjjrage/Control-de-facturas/pull/38), `codex/compras-ventas-merge-prep` → `main`. Estado inicial **NO-GO**. La salida de este trabajo es evidencia, correcciones en ese PR y un dictamen; el merge y el despliegue quedan fuera de alcance.

## 0. Congelar el objeto bajo prueba

1. Consultar el SHA remoto de `main` y el del PR, `merge-base`, `git status` y `git diff --stat main...HEAD`. Registrar commit, fecha, hash de árbol y cantidad de archivos cambiados. Si `main` avanzó, reconciliar primero; si el árbol difiere del build probado, invalidar la corrida.
2. Inventariar **todos** los archivos del diff, agrupados por SQL/RLS, server actions/RPC, servicios, UI/rutas, tests, configuración y documentación. Revisar cada archivo de runtime cambiado; para UI, usar también `docs/audits/2026-10-17-inventario-cobertura.json` como inventario de superficies (179 entradas en el registro previo), sin asumir que “NO PROBADO” significa PASS. Marcar explícitamente archivos sin prueba directa y su riesgo.
3. Confirmar por lectura y sin imprimir claves que la URL del entorno termina **exactamente** en `kyiihlkncatojvlasoag.supabase.co`; verificar el ledger, permisos de RPC, triggers y RLS de esa base. No usar el enlace implícito de Supabase CLI. No consultar producción `ezucivipgmbvamhugkbj` ni otra cuenta.
4. Definir la matriz de fixtures QA antes de mutar: empresa A y B, roles Administración/Operativo y los externos necesarios, proveedores/clientes sintéticos, obra, ítems, depósito, caja, adjuntos inocuos. Nombres prefijados y un `run_id` permiten búsqueda y limpieza. Restringir emails y enlaces a usuarios QA controlados; registrar cómo se revocan tokens. No reutilizar registros reales para pruebas mutables.

## 1. Auditoría de código y contratos

Para cada hallazgo registrar ruta y línea, entrada controlada por usuario, regla esperada, salida actual, reproducción, impacto, severidad P0/P1/P2 y prueba que faltaba. Un comentario de estilo sin consecuencia funcional no bloquea por sí solo el merge.

| Área | Revisión obligatoria | Invariantes a demostrar |
|---|---|---|
| Identidad, tenancy y roles | Todas las rutas/actions/RPC tocadas; derivación de empresa y actor; `SECURITY INVOKER/DEFINER`, `GRANT/REVOKE`, RLS y Storage policies | Un ID o token de otra empresa jamás permite leer contenido, modificar, borrar, confirmar ni cobrar; un rol externo no hereda privilegios internos |
| RFQ → oferta → OC | `app/(internal)/rfqs/`, `app/cotizar/[token]/`, `lib/rfq/`; estado, vigencia/rotación del enlace, revisión humana y cálculo | No se crea OC antes de confirmar; cotización, proveedor, impuestos, moneda, original y condiciones coinciden; reintento no duplica OC |
| Recepción y documentos | `app/(internal)/orders/`, `app/recepcion/[token]/`, `app/warehouse/[token]/`, `lib/inventory/`; concurrencia, idempotencia, actor externo y compensación Storage | Recepción parcial/final respeta máximos; movimiento de stock tiene procedencia real; portal revocado no escribe; fallo de archivo no deja estados o adjuntos huérfanos |
| Compra → factura → pago | `app/(internal)/invoices/`, `lib/invoice-*`, `app/(internal)/pagos/`, `app/(internal)/tesoreria/`; atomicidad del RPC, original, identidad, conciliación y ejecución | Cabecera y líneas se guardan juntas; una identidad fiscal no se paga dos veces; factura/OC/matching se reconcilian; tesorería debita exactamente una vez |
| Venta → OT → cobro | `app/(internal)/ventas/`, `app/cotizacion/[token]/`, `app/(internal)/ordenes-trabajo/`, `lib/sales-*`; cadena de origen, estados, montos y retries | Proforma/aceptación/OT/remisión/factura conservan cantidades y totales; transición prohibida falla en servidor; cobro repetido conserva un recibo y un asiento |
| Datos y migraciones | Las siete migraciones enumeradas en el handoff, funciones llamadas desde TS, índices, triggers, políticas y orden de instalación | SQL es idempotente cuando corresponde, el cliente solo posee permisos mínimos y todo resultado de fallo revierte o queda explícitamente recuperable |
| UI de todo el ERP | Paneles inventariados y cada pantalla tocada; títulos, ayudas emergentes, estados vacíos, tarjetas, hover/foco, acciones destructivas, mobile/desktop | Texto principal mínimo, explicación en ayuda accesible, tarjeta completa se ilumina al hover/foco, señalizadores comprensibles, acciones y errores visibles sin ambigüedad |

Contrastar explícitamente las fronteras entre código TS y SQL (nombres/argumentos de RPC, tipo de respuesta, errores transaccionales y permisos). Buscar escrituras por pasos restantes que puedan dejar media operación, `service_role` en caminos expuestos, carreras de reintento, checks solo en UI y controles de empresa derivados de campos enviados por el cliente. Leer la guía relevante de `node_modules/next/dist/docs/` antes de modificar código Next 16.3.8, como exige `AGENTS.md`.

## 2. Banco de pruebas reproducible

Usar el **mismo SHA** para pruebas y dictamen. Primero correr la suite unitaria controlada, TypeScript, lint enfocado y `npm.cmd run build -- --webpack`; registrar comandos, versiones y resultados. La corrida previa de 2296 PASS y 16 omitidas es contexto, no resultado de este SHA si cambia código.

Para E2E levantar `npm.cmd run start -- --hostname 127.0.0.1 --port <puerto>` después del build y comprobar el host de Supabase en el proceso. El `playwright.config.ts` predeterminado inicia `next dev`; crear configuración/harness específico o usar scripts de navegador que **se conecten al servidor ya levantado** y no lancen otro. No usar por defecto `tests/e2e/auth.setup.ts`: incluye correos fijos y sesiones en disco. El harness nuevo debe crear usuarios QA de dos empresas, renovar sesiones, ejecutar, limpiar en `finally` y consultar luego que no quedaron filas, objetos Storage ni usuarios de prueba. Mantener claves y estados de sesión fuera de Git. Si un fixture no puede limpiarse, conservar su ID y marcar NO-GO.

Para cada caso, registrar: SHA/árbol, ref de base, rol y empresa, `run_id`, IDs de entidades, pasos, captura o trace, salida de red/servidor relevante, consulta de lectura posterior, resultado esperado/observado y limpieza. No basarse solo en screenshot ni solo en HTTP: verificar efecto persistido y ausencia de efectos prohibidos. Los scripts SQL con `ROLLBACK` prueban contratos puntuales, pero no el circuito con Auth, navegador y Storage.

## 3. Matriz de recorridos E2E y ataques

Los IDs P1–P4, V1–V2, S1, D1 y U1 conservan correspondencia con el [runbook previo](2026-10-17-e2e-premerge-runbook.md). Agregar variante feliz, adversarial, reintento y lectura posterior donde se indica.

| ID y prioridad | Ejecución en build final + base aislada | Criterio de aprobación |
|---|---|---|
| P1 · P0 | Administración crea RFQ; proveedor QA usa enlace, carga oferta y original; comparar cotizaciones, aprobar, previsualizar y confirmar OC; repetir confirmación y probar enlace expirado/revocado | Una OC y un original correctos; ninguna OC prematura ni duplicada; token revocado sin escritura; importes/proveedor/condiciones iguales entre oferta, aprobación y OC |
| P2 · P0 | OC → recepción parcial/final (interno y portal externo) → stock → factura original → matching → orden de pago → ejecución y tesorería; repetir recepciones y pago, interrumpir una operación | Acumulados nunca superan OC; un movimiento por recepción; actor/metadata auditables; original e identidad únicos; un débito y saldo exacto; sin escritura parcial |
| P3/R03 · P0 | Documento válido, duplicado, tipo/tamaño rechazado y **fallo real de Storage** en recepción; verificar estado antes/después y recuperación/reintento | Ningún stock/factura duplicados; fallo deja transacción recuperable y cero objeto/registro de original huérfano; error visible al usuario |
| P4/C07 · P0 | Factura manual con dos líneas, segunda inválida; original inexistente/no verificable; identidad repetida; error al vincular/conciliar OC; luego reintento válido | Cero cabeceras/líneas nuevas tras error atómico; original/identidad/OC sin estado intermedio falso; reintento correcto sin duplicado |
| V1/V05 · P0 | Cliente QA recibe proforma, acepta vía enlace; crear/aprobar OT, remitir, facturar, registrar cobro desde UI; enviar mismo intento dos veces y uno conflictivo | Procedencia, cantidades, impuestos y totales consistentes; exactamente un recibo/asiento para retry idéntico; conflicto rechazado; saldo correcto |
| V2/OT01–02 · P0 | Transiciones OT válidas e inválidas desde UI y RPC; aprobación falsa; cantidades acumuladas en remisiones; cancelación con y sin derivados activos | Servidor impide saltos/reapertura y exceso; cancelación no deja documentos activos inconsistentes; estados mostrados igual que los persistidos |
| S1/V06 · P0 | Empresa B intenta URL, server action, RPC y Storage de entidades de A con lectura, creación, edición, borrado, recepción y cobro; repetir con roles inferiores/anónimo | Ninguna divulgación ni escritura cruzada; permisos mínimos efectivos; operaciones autorizadas de A siguen funcionando; validar contenido + RLS, no solo HTTP 200/404 |
| D1/C06 · P1 | Subir PDF con texto, imagen legible y PDF escaneado sin capa de texto por entradas documentales críticas; verificar extracción y revisión humana | Cada formato produce datos correctos o error claro; C06 requiere corrección comprobada o decisión explícita de producto documentada antes de GO |
| U1 · P1 | Hacer smoke de navegación de las 179 superficies inventariadas según rol y auditoría profunda de paneles cambiados, incluidos dashboard, clima, estado de costeo, depósito/QR y flujo documental; 2 anchos, teclado y hover/foco | Ningún panel roto, acción inaccesible, ayuda ilegible ni error de consola funcional; títulos concisos y ayudas útiles; tarjeta completa responde visualmente, con señalizadores y foco accesible |

Añadir variantes de concurrencia para stock, identidad fiscal y cobro (dos sesiones/dos solicitudes simultáneas), expiración y revocación de enlaces, validación de importes con separadores de miles e IVA mixto, y recuperación tras refresco/reintento. Si una superficie de las 179 requiere datos no disponibles, registrar exactamente cuál, fixture faltante y resultado **NO PROBADO**; no rellenar PASS por analogía.

## 4. Corrección, regresión y dictamen

Ante un defecto P0/P1, documentar reproducción antes de arreglar, corregir en el **mismo PR #38**, añadir una prueba que falle antes y pase después si la regresión tiene contrato automatizable, volver a ejecutar el caso E2E y los recorridos vecinos afectados, más build y suite pertinente. Si se necesita SQL nuevo, revisar que la migración apunte solamente al ref aislado; verificar ledger y permisos después. No ejecutar cambios de producción.

Cerrar con una tabla por ID: PASS/FAIL/NO PROBADO, evidencia concreta, SHA, defectos y commits de corrección. Conciliar conteos y objetos QA con `run_id`, confirmar cero huérfanos, verificar que la rama sigue cero commits detrás de `main` y que las pruebas corresponden al último SHA. Separar problemas del producto de fallos de infraestructura: los checks Vercel `[MISSING_SERVICES]` y el deployment `CANCELED` no prueban ni invalidan por sí mismos los recorridos locales; documentarlos aparte sin crear otro preview.

**GO** exige diff funcional revisado sin P0/P1 abiertos, P1–P4/V1–V2/S1 aprobados, D1 resuelto o limitación aceptada expresamente, U1 sin bloqueos, roles y superficies inventariados sin omisiones ocultas, tests/build del último SHA en verde y limpieza completa. Cualquier caso crítico fallido o sin evidencia mantiene **NO-GO**. Entregar informe y PR actualizado para decisión humana sobre el merge; no convertir el dictamen en merge automático.
