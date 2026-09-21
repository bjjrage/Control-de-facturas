# ERP Manual V3 para Rodrigo

## Alcance

Este manual describe únicamente superficies, relaciones y controles presentes en el checkout de esta rama. No contiene saldos, nombres de clientes, existencias, credenciales ni otros datos vivos. Una afirmación del manual no convierte una capacidad de la aplicación en una capacidad ejecutable por Rodrigo.

Rodrigo debe separar tres cosas:

1. conocimiento estático del ERP;
2. lectura de datos vivos mediante una herramienta registrada;
3. cambios de estado, que dependen de permisos y aprobación.

## Cómo leer el ERP

La empresa y el rol vienen del perfil autenticado. El Gateway vuelve a validar tenant, permisos, esquema y riesgo. El modelo no puede inventar un UUID, monto, fecha, contacto o nombre. Si el usuario pide un valor actual, Rodrigo debe consultar un tool de lectura válido o reconocer que todavía no puede hacerlo.

El runtime entrega contexto estático de forma selectiva según el mensaje. Un saludo social no carga el manual. Un mensaje sobre stock, compras, planificación, licitaciones, finanzas, email o documentos carga solo los documentos relevantes. `get_erp_knowledge` permite pedir contexto conceptual adicional y nunca consulta datos vivos. `resolve_erp_entity` resuelve referencias humanas contra datos vivos y tenant-scoped; no crea IDs ni decide una ambigüedad por su cuenta.

## Módulos verificados

- Administración: dashboard, empresas, usuarios, configuración, clientes, proveedores y ventas.
- Obras: proyecto, presupuesto/cómputo, cronograma, BIM, ejecución, stock de obra, personal, subcontratistas, certificados e informes.
- Comprar: proveedores, RFQ/cotizaciones, órdenes de compra, facturas, recepción y relación con stock.
- Vender: ventas, facturas de venta, proformas, notas de crédito y cobros.
- Finanzas: flujo de caja, tesorería, cuentas financieras y órdenes de pago.
- Licitaciones: convocatorias, lotes, ítems, oferentes, ofertas, documentos, competidores y Auction Lab.
- Operaciones auxiliares: planillas, scanner, documentos, email y portales de depósito.

## Operaciones V3 ejecutables

- `manage_master_data`: clientes, proveedores y obras; alta, edición, activación o estado donde la acción existente lo permite.
- `get_project_modeling_overview`, `manage_budget_item` y `manage_production_recipe`: lectura de presupuesto/BIM/cómputo, partidas, avance y recetas/BOM reales.
- `preview_weekly_plan` calcula sin guardar; `save_weekly_plan` persiste o compromete. Con `mrp_commit` y `COMMITTED`, la acción existente recalcula cobertura y reserva mediante la RPC atómica. No genera una OC automáticamente.
- `manage_certificate`: crea, edita líneas de borrador y transiciona Elaborado/Verificado/Aprobado.
- `manage_sales_document`: crea, edita y emite documentos comerciales. `create_invoice` registra facturas de proveedor, incluso una sesión de scanner ya completada; no crea pagos.
- `manage_inventory_operation`: recepciones de OC, ubicaciones, portal de depósito y rendiciones; son operaciones físicas.
- `manage_climate_workday`: configuración, evaluación y decisiones de jornada existentes.
- `manage_tender`: decisión, seguimiento, paquete/evaluación, extracción de texto y conversión de una licitación GANADA a proyecto.
- `manage_company_document`: metadatos canónicos y sincronización de la proyección existente; no adjuntos binarios.

Cada mutación tiene riesgo 2 y espera aprobación humana. Las referencias deben resolverse con `resolve_erp_entity` antes de pasar UUIDs a un tool.

## Compras y reportes

La relación base de compras es RFQ → ítems → proveedores invitados → respuestas/cotizaciones → comparación → borrador de orden. Rodrigo puede leer y preparar superficies ya registradas; una solicitud enviada o una OC emitida sigue teniendo aprobación.

Las consultas transversales deben combinar lecturas vivas de dominio. No hay un informe mágico ni datos vivos dentro del manual.

## Email y documentos

Para un correo común se resuelve destinatario/objetivo, se prepara el borrador y se muestra el preview. `send_email` exige aprobación con snapshot íntegro e idempotencia. No se debe pedir obra, RFQ u OC si el usuario no los necesita.

## Límite duro de tesorería

Rodrigo puede leer saldos, cuentas a pagar/cobrar y órdenes existentes mediante `get_finance_overview`, pero nunca debe pagar, cobrar, transferir fondos, conciliar, liquidar ni registrar un movimiento monetario efectivo. Si se lo piden, debe rechazar la ejecución y derivar a la UI/proceso autorizado.

## Capacidades todavía no ejecutables

Personal, cuadrillas y subcontratistas; APU estructurado separado del presupuesto/receta; compras automáticas desde faltantes MRP; presentación a DNCP; Auction Lab/Auction Bot; carga binaria desde Scanner; adjuntos empresariales; cobros, pagos y tesorería. La lista canónica está en `CAPABILITIES-GAPS.md`.

## V4 — dominios operativos expuestos

Rodrigo puede leer partes y subcontratos por obra, el APU/BOM material real, estado de scanner, salas y eventos redacted del Auction Lab, operación de obra (avance, planificación, certificados y clima), inventario físico y documentos comerciales/órdenes de trabajo. Las referencias humanas deben pasar por `resolve_erp_entity` cuando el tipo esté disponible.

Las escrituras V4 de personal/subcontratos y componentes materiales de APU requieren aprobación humana. Las tools de inventario, certificados, clima, ventas, compras y documentos de V3 mantienen la misma compuerta. Preparar un email o un borrador de compra no envía, emite ni mueve dinero.

La cobertura no implica capacidades inexistentes: el modelo actual no contiene un APU estructurado de mano de obra/equipos, no presenta ofertas DNCP desde chat, no opera posturas del Auction Bot, no carga binarios desde conversación y no ejecuta cobros/pagos.

## Fuente

La representación runtime está en `lib/agent/knowledge/documents.ts` y el loader en `lib/agent/knowledge/loader.ts`. Este documento es la explicación humana y se mantiene alineado con esas entradas.
