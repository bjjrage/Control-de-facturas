# Antes / base / recovery

Fecha: 12/10/2026. Testigo `a61c655`; base `953ebba`. El histórico sólo se leyó; no se ejecutó contra ninguna DB. **Comparación dinámica histórica: BLOCKED / no ejecutada.**

| Recorrido | ANTES (código histórico) | BASE congelada | RECOVERY local | Comprobación actual |
|---|---|---|---|---|
| Nueva RFQ global | Monoítem, RFQ/COT; modalidad obra; metadatos | Tabla multiítem, propósito explícito; desaparece selección COT; errores reinician metadatos | RFQ/COT accesible; mantiene multiítem/propósito; conserva campos al error, resetea líneas tras éxito y reabre | PASS fixture Chromium/Firefox en dos anchos; no es persistencia DB |
| RFQ en obra | `projectId` y creación por rubro desde APU | Base mantiene contexto y consulta directa antes de OC; entrada misma `RfqDialog` | Conserva esa consulta; no vuelve a pedir obra conocida; enlaces a solicitudes por rubro; refresca obra incluso ante upload parcial | PASS FormData + acción RPC/revalidación; persistencia real BLOCKED |
| Detalle RFQ | Paneles de metadatos/archivos, compartir, comparativa | Workspace nuevo, fechas crudas, adjuntos/compartir antiguos fuera del caller | Metadatos, archivos, fechas y controles históricos reconectados; decisión actual conservada | Inspección fuente/tipos/build; equivalencia visual completa pendiente |
| Compartir proveedor | Copiar, QR, WhatsApp | Ancla a token | Mismo componente histórico, restringido al enlace vigente | UI→portal externo real BLOCKED; no entrega a terceros |
| Administración / proveedor externo | Contrato aprobado 1/10 confirmado por propietario: proveedor envía oferta estructurada + documento; sistema analiza/contrasta/prepara; humano decide. Caller automático original no localizado en Git inspeccionado | Envío guarda versión pero no dispara análisis; workspace exige botón manual | Mismo envío → readback canónico → lector/extractor/contraste existentes automáticamente; detalle prepara hechos en servidor sin botón de inicio | PASS servicio externo con transporte/DB simulados y XLSX real. E2E portal ERP persistente BLOCKED |
| Administración / carga interna | Se reconstruye separadamente del envío externo y de Costeo; no se infiere su comportamiento desde ManualQuoteDialog | Misma cadena canónica de submit, extracción manual posterior | Diálogo interno usa contrato vigente y el mismo análisis posterior automático; revisión ya tiene datos extraídos | Lector/acciones/tipos/build; E2E interno con Auth/Storage pendiente |
| Operativo / Costeo por rubro | `fb5af6c`: RFQ por rubro/APU, carga manual y portal compartido | Adopción factual de precio, señales y COST_DISCOVERY sin compra | Contexto obra/rubro y adopción humana conservados; no usados para diagnosticar ausencia de automatización administrativa | Contratos unitarios/SQL. Recorrido persistente completo pendiente |
| PDF libre / foto | Aprobación incluye adjuntos PDF/Excel/imagen; falta localizar el motor/caller completo que lo ejecutaba | Motor leído soporta texto PDF/Excel; imágenes/escaneos requieren capacidad adicional y mapeo PDF libre no está demostrado | Análisis se dispara, conserva límites/desconocidos; no se declara recuperada extracción general ni se reemplaza por transcripción manual | BLOCKED evidencia ejecutable de esa parte y E2E representativo |
| Error/segunda apertura | Sin prueba dinámica histórica | Error devuelto puede borrar datos y archivo | Datos/archivo permanecen, errores visibles, pending liberado; nueva apertura RFQ limpia tras éxito | PASS fixture, ambos navegadores/ancho |
| Comparación/propuestas → OC | Contrato humano del propietario; selección monoítem legacy sólo evidencia histórica | Revisión, asignación, autorización, preview/hash, confirmación; escenarios esperan review | Escenarios preliminares automáticos, sin asignación persistida; revisión sigue obligatoria para guardar y autorizar; enlaces OC; COST_DISCOVERY sin OC | PASS contratos/SQL PGlite y propuesta preliminar bloqueada para asignar. E2E con readback real BLOCKED |
| Compra directa | Editor anterior | Preview/confirmación actual, pero error borra proveedor/condiciones | Conserva controles actuales y datos al fallar preview | PASS fixture; confirmación real pendiente |
| Recepción, inventario, factura, pago | Hay escritores históricos incompatibles con base actual | Contratos actuales/R3 y recepción canónica | Conservados, no restaurados hacia atrás | Suite general PASS; E2E parcial/final/pago aislado BLOCKED |
| Cliente → proforma | Catálogo/editor/listados ya existentes | Misma estructura más conexiones posteriores legítimas | Conservados; editor mantiene cliente/notas tras error | PASS fixture y tests; última aprobación visual pendiente |
| Compartir → cliente → aceptar → OT | Portal `/cotizacion`, snapshot y contrato existentes | Esas superficies no cambiaron respecto del testigo | Conservadas | Contratos/cierre PASS; sesión externa, aceptación y reintento real BLOCKED |
| OT → remisión/factura | Conexión posterior incompleta en referencia | Main prepara borradores desde snapshot OT y protege procedencia | Conservado, no se vuelve a pedir cliente/moneda/líneas conocidas | Tests post-OT/procedencia PASS; UI+DB real pendiente |
| NC / cobro / reversa | Documentos y cobros existentes | Guardas post-OT/fiscales y ledger vigentes; error en formulario cobro pierde referencia | Guardas intactas; datos de cobro conservados | PASS fixture y suite de contratos; efectos reales BLOCKED |

## Evidencia y significado

- `recovery-evidence/base-browser/results.json`: componentes reales de BASE con acciones que devuelven `Fallo sintético`; evidencia de pérdida de campos/archivo. El timing de reset puede variar entre campos; no es la reproducción del error original en el servidor de Marcelo.
- `recovery-evidence/recovery-browser/results.json`: 36 casos de componentes reales recuperados. El análisis usa lector/mapeador/contraste reales sobre XLSX sintético y DB/Storage simulados. La prueba no llena los campos extraídos ni pulsa acción de extracción. Guardado, navegación y cobro siguen simulados. Servidor sólo loopback, requests externos bloqueados.
- Las capturas usan CSS mínimo del harness. Sirven para observar campos/errores, **no** para acreditar equivalencia visual con el diseño aprobado.
- `lib/rfq/__tests__/automatic-analysis.spec.ts`: acción externa real → submit service → original XLSX sin UUIDs → extracción/contraste. Sólo DB/Storage y RPC canónica simulados. Oferta estructurada y documento tienen precios diferentes; el test no precarga los hechos extraídos. Verifica fallo posterior al commit, token revocado, checksum, datos ambiguos y ausencia de decisiones automáticas.
- `lib/rfq/__tests__/creation-recovery.spec.ts`: RPC vigente, propósito/obra/tipo, upload posterior fallido y ausencia de éxito ficticio.
- Los tests generales existentes conservan su valor dentro de su capa. No se presentan como certificación completa de ambos recorridos.

## Batería de aceptación del encargo

| Caso | Estado y alcance |
|---|---|
| A global / cerrar / reabrir / segunda creación | PASS componente; listado/DB persistente BLOCKED |
| B obra/necesidad | PASS contexto de formulario/acción y contratos existentes; UI ERP real BLOCKED |
| C compartir por controles UI y sesión externa | BLOCKED ERP real; cableado recuperado |
| D portal proveedor/documento/envío/versiones | PASS acción externa con análisis automático real y DB/Storage simulados; E2E desde portal real/versiones persistentes BLOCKED |
| E carga interna/extracción | PASS servicio lector y validaciones; flujo interno persistente y formatos libres BLOCKED |
| F comparativa/propuestas/humano/OC/no duplicación/COST_DISCOVERY | PASS propuesta preliminar sin review/guardas y suite de contratos/PGlite; E2E BLOCKED |
| G recepción/stock/factura/matching/pago | PASS regresión de contratos; E2E con DB/Storage/Auth aislados BLOCKED |
| H Ventas completo, NC/reversa | PASS regresión y formularios; E2E cliente→OT→documentos→cobro BLOCKED |
| I navegación/recarga/atrás/segunda visita | PASS apertura del componente RFQ; AppShell y rutas reales con Auth BLOCKED |
| J negativos | PASS error sintético y conservación; unitarios token/empresa/MIME/número ambiguo; matriz completa ERP BLOCKED |

Ninguna llamada SIFEN/OCR/modelo pagado, envío a terceros o movimiento productivo fue ejecutado.
