# Plan de corrección previo a beta — Control de Facturas

**Estado al 22/10/2026:** A1–A7 corregidos en `main` local (`C:\e2e-main`) y verificados contra QA. Las cinco migraciones beta están aplicadas únicamente en QA; producción sigue en `ec090593`, con 79 migraciones y ninguna beta. Sin push ni deploy. La comparación de IA es preliminar y no autoriza cambiar el lector. Evidencia: `C:\e2e-main\docs\audits\2026-10-22-beta\README.md` y `model-matrix.md` en esa carpeta.

Validación: build de producción local, TypeScript, 2.467 pruebas aprobadas (16 omitidas), regresiones de navegador de certificados/proveedores/stock/scanner y dos adjudicaciones RFQ reales en QA. Se conserva el historial duplicado de proveedores; nuevas altas con el mismo RUC normalizado quedan bloqueadas. Las sesiones temporales de scanner anteriores deberán regenerarse cuando se aplique su migración en un futuro despliegue.

Origen: E2E funcional contra QA (`kyiihlkncatojvlasoag`) sobre `main` ec090593. Informe completo con evidencia: `C:\e2e-main\.qa\INFORME_PARCIAL.md`. Specs reproductores: `C:\e2e-main\tests\flows\` (01–24). Scripts de RLS: `C:\e2e-main\.qa\rls-roles.cjs`, `C:\e2e-main\.qa\rls-barrido.cjs`.

Reglas del proyecto: trabajar en `main`, commits chicos, sin ramas nuevas, sin `git stash -u` / `reset --hard` / `clean -fd`. Responder y escribir mensajes de UI en español. Leer `node_modules/next/dist/docs/` antes de tocar APIs de Next (esta versión tiene cambios incompatibles). Fail-closed: ante ambigüedad, bloquear o preguntar, nunca adivinar.

## Bloque A — Corregir ANTES de la beta

| # | Prio | Problema | Dónde | Criterio de aceptación |
|---|---|---|---|---|
| A1 | P2 | Un usuario con rol `comercial` lee por API todas las cuentas financieras y movimientos de tesorería (29/29 y 93/93 en QA), aunque la UI le niega `/tesoreria`. Facturas, cobros y OP sí están restringidos por rol. | Políticas RLS de `cuentas_financieras` y `movimientos_tesoreria` (nueva migración) | `rls-barrido.cjs`: comercial ve 0 filas de ambas; admin y administración siguen viéndolas; revisar también tablas hermanas de tesorería y flujo de caja |
| A2 | P2 | Sobre-certificación: se puede cargar avance sobre lo contratado (acumulado 105 %); "Elaborar" lo deja pasar; la pantalla no refresca el acumulado tras guardar | `app/(internal)/projects/[id]/` certificados + acción de servidor que guarda avance | Bloquear (o exigir justificación explícita) cuando acumulado > contratado; validar en servidor, no solo en UI; refrescar acumulado tras guardar |
| A3 | P2 | "Crear borrador de factura" desde un certificado crea el borrador pero redirige a `/facturas-venta/<id>` (404) | `app/(internal)/projects/[id]/certificados-table.tsx:256` | Redirige a `/ventas/<id>` (verificar la ruta vigente); el spec 20 llega al borrador sin 404 |
| A4 | P2 | Proveedor duplicado (mismo nombre + RUC) se crea sin aviso | Alta de proveedores (acción de servidor + índice único por `empresa_id` + RUC normalizado) | Rechazo con mensaje claro; índice único parcial que no rompa datos existentes (revisar duplicados actuales antes de la migración) |
| A5 | P3 | Carga inicial de stock: el mensaje de éxito sale en rojo y el formulario no se limpia; un segundo clic duplica el saldo de apertura | `app/(internal)/inventario/carga-inicial-stock-dialog.tsx` | Éxito en estilo de éxito, formulario reseteado o diálogo cerrado, botón deshabilitado tras enviar; idealmente clave de idempotencia |
| A6 | P3 | Scanner: "Cancelar" en el escritorio no invalida el PIN; la sesión sigue `connected`; PIN en texto plano (`scan_sessions.pin_code`) | Flujo de `scan_sessions` | Cancelar marca la sesión cancelada y el celular ya no puede vincularse; evaluar guardar hash del PIN |
| A7 | P3 | OC nacida de RFQ guarda `is_cheapest=false` y `selection_reason=OTRO` aunque se eligió la más barata con motivo "Precio conveniente" | Adjudicación de RFQ → creación de OC | Campos coherentes con la oferta elegida; spec 09 lo verifica |

## Bloque B — Modelo de IA (recomendación y comparación previa en QA)

**Resultado preliminar del 22/10:** 42 llamadas reales, 14 documentos sintéticos por lector. Luna y Sol: 14/14 sin diferencias en los campos puntuados; línea base: 13/14 (inventó un importe de línea que solo figuraba en la cabecera). Costo calculado con consumo medido y caché: línea base USD 0,048021; Luna USD 0,004746; Sol USD 0,087456. Latencia media: 3,14 s / 4,31 s / 4,09 s, respectivamente. C06 es un PDF sintético rasterizado, no un escaneo real. Faltan manuscritos, fotos reales y varias páginas con resultados revisados por una persona, los negativos de negocio completos y los flujos 15/16/17 con el candidato en app y worker. **Se mantiene el lector actual.** Luna sigue como candidato preferido para completar QA; esta muestra no justifica activar segunda lectura con Sol.

**Recomendación:** evaluar **GPT-6 Luna (`gpt-6-luna`) como modelo principal** de extracción y **GPT-6.1 Sol (`gpt-6.1-sol`) como segunda lectura para documentos difíciles**, únicamente si la comparación demuestra que mejora esos casos. La elección de Luna se basa en su orientación a tareas concretas de alto volumen y su costo; todavía no se ha demostrado que lea estas facturas mejor que el lector actual.

Proveedor propuesto: **OpenAI**, mediante **Responses API** (`https://api.openai.com/v1/responses`), con entrada de texto/imágenes y salida estructurada con JSON Schema estricto. Ambos modelos admiten imágenes y salidas estructuradas. Para los PDF, conservar y evaluar el recorrido actual de texto o imágenes de páginas; esta recomendación no exige cambiar simultáneamente el procesamiento de archivos.

Fuentes oficiales consultadas el 21/10/2026: [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol) y [Responses API](https://developers.openai.com/api/docs/guides/responses).

**Condición previa obligatoria:** completar y documentar la comparación en QA antes de sustituir el modelo del lector. Los candidatos se probarán mediante un arnés o configuración exclusiva de evaluación, sin cambiar el modelo predeterminado de la aplicación. Esta etapa no autoriza cambios de modelo, variables, servicios ni despliegues en producción.

### B1. Inventario y línea base

- `lib/invoice-extraction.ts`: lector compartido por la app y el worker; en `main` ec090593 combina `gpt-4o-mini` para texto/fotos y `gpt-4o` para páginas de PDF escaneadas. Confirmar los puntos de llamada sobre el SHA que se evalúe.
- `lib/invoice-item-match.ts`: coincidencia de ítems.
- `lib/certificate-ai.ts`, `lib/template-gen.ts` y `lib/procurement/operational-analyst-llm.ts`: otros consumidores de IA; inventariarlos sin sustituirlos automáticamente por el resultado de una prueba de extracción de facturas.
- `lib/__tests__/invoice-scanned-pdf.spec.ts`: contiene una expectativa de `gpt-4o`; mantenerla como referencia hasta decidir la migración.
- Ya existen usos de `gpt-6-luna` en otros módulos del repositorio; eso no demuestra su precisión para facturas ni confirma el acceso efectivo de la app y el worker al modelo.

### B2. Comparación reproducible en QA, antes del cambio

1. Usar exclusivamente QA (`kyiihlkncatojvlasoag`), cuentas y documentos de prueba. Registrar SHA, modelos exactos, configuración, esquema, prompts y versiones del procesamiento de archivos. No utilizar ni modificar producción (`ezucivipgmbvamhugkbj`).
2. Comparar el lector actual, Luna y Sol contra los mismos documentos y resultados esperados revisados por una persona. Incluir PDF digitales, escaneos reales —especialmente C06—, fotos, manuscritos, varias páginas, IVA 5/10/exento, separadores de miles y cantidades decimales. Mantener los mismos datos de entrada y controles de negocio para que la comparación sea atribuible al modelo.
3. Medir exactitud por campo: RUC del emisor, número y fecha del documento, moneda, subtotal, IVA, total y todas las líneas, cantidades y precios. Registrar omisiones, valores inventados, rechazos, reintentos, latencia y costo real por documento a partir del consumo de tokens. Las tarifas por token no equivalen por sí solas al costo de procesar una factura.
4. Verificar también imagen en blanco, datos ilegibles, RUC ajeno, aritmética inconsistente, duplicados, factura de más e instrucciones maliciosas dentro del documento. Un JSON conforme al esquema no prueba que los datos sean correctos. Ningún candidato puede aprobar estos casos indebidos ni completar importes por inferencia.
5. Ejecutar las regresiones de QA `16-factura-ia-negativos`, `15-pago-completo` y `17-worker-bulk` con el recorrido candidato, conservando la línea base para comparar. Verificar tanto la app como el worker y que los reintentos no dupliquen datos.
6. Entregar una matriz por modelo y documento con resultados esperados/observados, diferencias, precisión, tiempos y costos. Elegir Luna solo si no empeora los campos críticos ni las protecciones respecto de la línea base. Evaluar por separado si una segunda lectura con Sol aporta mejora suficiente; no habilitarla por suposición. Si no se cumplen los criterios, conservar el lector actual y documentar los fallos.

### B3. Requisitos de implementación, después de la comparación

1. Centralizar el acceso a OpenAI y la configuración del modelo. Definir variables explícitas para el modelo principal y, si se justifica, el de segunda lectura; distinguir configuración de extracción de la de otros consumidores. Compartir el contrato entre app y worker.
2. Adaptar y validar los parámetros de Responses API, el parseo de respuestas, los límites y los tiempos de espera. No limitar la migración a reemplazar el nombre del modelo en el `fetch` antiguo ni asumir compatibilidad de `temperature: 0`.
3. Mantener fail-closed y las validaciones deterministas de identidad, empresa, duplicados, cantidades y aritmética. Si el modelo falla, devuelve datos inválidos o quedan discrepancias, bloquear la operación y exigir revisión humana. Una segunda lectura no habilita a corregir lo que dice el documento ni a autorizar pagos automáticamente.
4. Actualizar `invoice-scanned-pdf.spec.ts` conservando sus comprobaciones de comportamiento; no cambiar solo la expectativa del nombre para obtener un resultado verde. Repetir las regresiones del recorrido elegido.
5. Documentar las variables y la configuración que corresponderían a Vercel (app) y al worker, junto con el resultado comparativo y la forma de volver al lector anterior. **No aplicar esa configuración en producción en esta etapa.**

## Bloque C — Verificar en producción antes de la beta (no es código)

1. **Vercel confirmado en lectura:** `OPENAI_API_KEY` está definida para producción como variable sensible. No se leyó ni publicó su valor. Worker: pendiente de reconfirmación, porque el conector y la CLI de Railway requieren reautenticación.
2. **App confirmada:** despliegue de producción `dpl_EiQ6cpNY8emtWu9VjkGQHGa4xHVZ`, `READY`, `main` `ec090593`. Worker: última evidencia del release del 20/10 indica `ec090593` exitoso; no equivale a comprobar que siga corriendo hoy.
3. **QA confirmado:** los cuatro modelos tienen acceso y completaron solicitudes reales con la clave de QA. El acceso/saldo de la clave de producción no se considera verificado por esto. No hay cambio de modelo aprobado.
4. **Pendiente:** factura real de la usuaria beta y recorrido completo. No se crearon operaciones financieras en producción.
5. **Respaldo anterior localizado:** copia previa al release, del 20/10 a las 01:40 UTC. Falta verificar restauración y respaldo actualizado antes de la carga real; no se presenta esa copia como un respaldo nuevo.
6. **SIFEN pendiente:** producción no tiene variables `GOEKUA_*` configuradas. Si la beta requiere facturación electrónica real, sigue siendo bloqueante.
7. **Confirmado:** producción tiene `20261013153336 fix_accept_quotation_ot_code`; QA todavía no. QA: 83 migraciones (incluidas las cinco beta); producción: 79 (sin beta).
8. **Nota anterior revisada:** las 27 funciones comprobadas de las migraciones del release existen en producción. Doce coinciden con su fuente y quince presentan diferencias de codificación de mensajes con tildes; no se detectaron diferencias lógicas al normalizar esa codificación. La afirmación de ocho migraciones pendientes no describe el estado actual comprobado. No se modificó producción.

## Bloque D — Después de la beta (feedback)

- Mensajes en inglés (alta de usuario con email repetido, validación nativa del navegador).
- Botones que llevan a callejones: "Preparar remisión" en proforma suelta (404); factura desde remisión suelta no emitible; ocultar o explicar.
- Etiquetas: OC pagada ("APTO PARA PAGO" vs "Cerrada"); nota de crédito "Emitida (por cobrar)".
- Radar de licitaciones acepta mínimo > máximo.
- Certificados: casillas "Anterior"/"Presente" sin etiqueta; botones de eliminar certificado y obra casi iguales.
- OC: campo "Impuesto %" suelto y sin valor por defecto.
- `/api/document-uploads`: loguear la causa del 400 y no depender del Origin literal detrás de proxies.
- Vía manual para facturas ordinarias cuando la IA no está disponible.
- Obras sin partidas no permiten salida desde el portal depositero.
- eslint: 417 errores / 255 warnings (`no-explicit-any`); suites Playwright existentes desactualizadas (21 fallas, ver informe).

## Bloque E — Auditoría de código (siguiente fase, por capas)

1. RLS y migraciones: revisar cada política contra roles (comercial / administración / admin) y contra otra empresa; empezar por tesorería.
2. Server actions y rutas API: chequeo de rol y de `empresa_id` en cada una.
3. Cadena de pagos y tesorería en profundidad.
4. Subidas, portales con token (depositero, recepción, cotizar), scanner.
5. Dependencias, secretos y configuración.

## Datos de prueba que dejó el E2E en QA (no afectan producción)

Entidades con prefijo "QA" (OC, RFQ, proveedores, facturas V-00160–V-00176, un material y su carga inicial, certificados de prueba, usuario `qa-usr-rmviv5fxl@example.test` inactivo). El perfil de radar de la empresa A quedó con mínimo 9.000.000 y máximo 1.000 (valor original no guardado).
