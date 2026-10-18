# Candidato único y auditoría E2E final antes de `main`

Fecha: 17/10/2026. **Estado: preparado para ejecutar la auditoría E2E; todavía NO-GO para merge.** Este documento no certifica casos sin ejecutar ni autoriza operar producción.

## Fuente de verdad

- `main` en GitHub: `953ebba505b38313bd3e18e6cb9fbf31b7e1eb89`.
- Único candidato a integrar: `codex/compras-ventas-merge-prep`, [PR #38](https://github.com/bjjrage/Control-de-facturas/pull/38), contra `main`. La rama contiene en línea recta los ocho commits de `codex/compras-ventas-integration` y los cuatro commits adicionales publicados de preparación. La rama `integration` es un ancestro, no otro PR que se deba mergear.
- `recovery/compras-ventas-approved` se separó del mismo `main` por diez commits históricos. No se hace un merge ciego de esa rama: sus contratos de Compras/Ventas se incorporaron parcialmente en `098afbc` y evolucionaron después. Al comparar los 41 archivos de código/pruebas que ambas líneas tocaron, once conservan el mismo blob; los restantes tienen cambios posteriores. Se recuperó la guarda de calentamiento del AppShell en desarrollo que sí faltaba. Sus informes, capturas y fixtures históricos quedan en esa rama como evidencia, sin incorporarlos al runtime final.
- La atomicidad de facturas manuales se preparó primero en la copia local. Antes de la auditoría, congelar y anotar el SHA remoto final, y comprobar que su árbol contiene el cambio. No correr E2E contra un SHA distinto.
- Base aislada única: `kyiihlkncatojvlasoag`. Producción `ezucivipgmbvamhugkbj` queda excluida. No se requiere ni se prepara otro proyecto Supabase ni otro despliegue Vercel. El navegador puede usar el build local del candidato conectado a la base aislada.

## Preflight reproducible

1. Confirmar SHA de `main`, SHA del PR y ancestro común; exigir que el PR esté delante de `main` y cero commits detrás. Registrar diff y migraciones incluidas. Si `main` avanzó, detener la ejecución y reconciliar primero.
2. Comprobar que el host de `NEXT_PUBLIC_SUPABASE_URL` del entorno de pruebas sea exactamente `kyiihlkncatojvlasoag.supabase.co`. No imprimir claves. Verificar que el ledger de esa base incluya las migraciones del candidato y los permisos `anon`/`authenticated` esperados. Ningún comando de migración debe apuntar a producción.
3. Ejecutar `npm.cmd test -- --run`, `npm.cmd exec -- tsc --noEmit`, lint enfocado en archivos nuevos y `npm.cmd run build -- --webpack`. Levantar **ese build** en loopback para navegador, no un `next dev` que cambie fuentes bajo prueba.
4. Preparar usuarios y empresas QA temporales con dos empresas separadas y roles Administración, Operativo y proveedor/cliente externo. Guardar IDs de fixtures para limpieza y lecturas posteriores. No usar documentos ni destinatarios reales.

## Matriz de ejecución E2E

| ID | Recorrido con navegador y base aislada | Evidencia mínima para PASS |
|---|---|---|
| P1 | RFQ Administración → enlace de proveedor → oferta estructurada y original → análisis/contraste → revisión humana → preview → autorización → confirmación de OC | Una sola OC con importes, proveedor, condiciones y adjunto correctos; ningún OC antes de confirmar; reintento sin duplicado. |
| P2 | OC → recepción parcial y final → stock → factura con original → matching → orden de pago → tesorería | Cantidades acumuladas exactas, movimientos trazables, identidad de factura única, líneas e importes consistentes, débito de tesorería una vez. |
| P3 | Portal de recepción: documento válido, duplicado, archivo rechazado y fallo real de Storage | No se duplica stock ni factura; fallo deja estado recuperable y sin original huérfano. Corresponde a R03. |
| P4 | Factura manual: segunda línea inválida, original no verificable y vinculación fallida a OC | Una línea inválida deja cero cabeceras/líneas nuevas; el tramo original/identidad/OC no deja escritura parcial. Corresponde a C07. |
| V1 | Cliente → proforma → enlace externo → aceptación → OT → remisión → factura → cobro y reintento | Documentos con procedencia y totales correctos; cobro reintentado conserva un solo recibo y un solo asiento. |
| V2 | OT: transición permitida/prohibida, aprobación, cantidades acumuladas y cancelación con derivados | El servidor rechaza saltos y reaperturas; cantidades no exceden origen; cancelación no deja documentos activos inconsistentes. Corresponde a OT01/OT02. |
| S1 | Dos empresas y todos los roles: abrir, leer, crear, editar y ejecutar RPC con IDs de la otra empresa | Sin contenido ajeno visible ni escritura cruzada; las operaciones propias siguen funcionando. Incluye V06 y matriz de roles. |
| D1 | PDF con texto, imagen y PDF escaneado sin texto en el flujo documental | Resultado y límites observados por formato; C06 se corrige o se acepta expresamente como limitación antes del GO. |
| U1 | Dashboard y paneles críticos, navegación ida/vuelta, refresco, dos anchos de pantalla y ayuda emergente | Contenido legible, acciones accesibles, valores/estados conservados, sin error de consola que afecte el flujo. |

Cada caso se registra con SHA de código, ref de base, usuario/rol, IDs de entidades, captura o traza, consulta de lectura posterior, resultado y limpieza. El cierre comprueba que no quedan empresas, usuarios, adjuntos o documentos QA huérfanos. Si un caso falla, el dictamen permanece NO-GO y se corrige en este mismo PR antes de repetir **ese** recorrido y su regresión relacionada.

## Puerta de merge

GO requiere P1–P4, V1–V2, S1, D1 y U1 resueltos o, para una limitación de producto como C06, una decisión explícita y documentada; build y tests verdes en el mismo SHA; diff final revisado; cero fixtures huérfanos; y comprobación de que `main` no avanzó. Recién entonces se cambia el PR de borrador a listo y se propone el merge. Este procedimiento no incluye merge automático ni despliegue a producción.
