# Consolidación de main, QA e IASA

## Base y alcance

Main partía de 93d4a0e6; IASA y QA de 2cfe2eea. Ambos comparten la base funcional 9dba47ce. Se integra la rama verificada mediante merge, conservando historia y documentación de main. No se incorpora la rama del workspace rechazado.

El merge de consolidación no modifica fuentes operativas respecto de 2cfe2eea. Los cambios adicionales son identificación del entorno, política de publicación y definiciones/archivos de importación. No se cambian fórmulas, precios contractuales, estados de certificados, permisos ni flujos de compras/ventas/tesorería.

## Inventario decidido

| Grupo | Decisión | Motivo |
| --- | --- | --- |
| Validación de números, fechas, columnas y vínculos | Conservar | Evita cargas ambiguas y conserva evidencia de origen. |
| Persistencia y verificación de jornadas | Conservar | Alimenta el libro operativo existente. |
| Colores y hover del calendario | Conservar | Cambios pedidos y aceptados por el usuario. |
| Lecturas APU completas y vínculos por fórmulas verificadas | Conservar | Evita truncar recetas ya guardadas. |
| Precio de planilla como última referencia | Conservar explícitamente | Ya publicado; compras/precios adoptados conservan prioridad. Es una fuente adicional, no un precio contractual nuevo. |
| Workspace nuevo de cómputo/Univer de la rama experimental | Excluir | No forma parte de la rama actualmente publicada que se consolida. |
| Manuales y generadores de main | Conservar | El merge no reemplaza la documentación por la versión antigua de la rama auxiliar. |
| Migraciones ya aplicadas y datos importados | Conservar | No se ejecuta DDL ni se modifica el historial para simular un rollback. |
| Copias/worktrees y artefactos de recuperación | Conservar identificados | No se borran trabajos ni datos para ordenar nombres. |

## Esquema existente

Producción conserva linked_workbook_project_import (20261029230545), workspace_draft_revision (20261030023454), import_workspace_draft (20261030050634), planilla_resume_atomic (20261030112130), workspace_live_budget_total (20261030153527) y workbook_import_workdays (20261031162733). QA tiene versiones propias de aplicación de los mismos cambios del workspace y jornadas.

La migración de jornadas del repositorio se llama 20261031154915_workbook_import_workdays.sql; el ledger de QA registra 20261031155517 y producción 20261031162733. Son historiales que requieren conciliación antes de un futuro db push. Esta publicación no ejecuta db push, reset ni reparaciones del ledger. Las funciones del antiguo workspace permanecen en la base; retirar una interfaz no elimina esas dependencias.

## Límites que esta consolidación no oculta

- El importador general no es una única transacción para todos los dominios; no promete reintentos globales sin duplicados. El importador APU usa su RPC transaccional existente.
- Algunas sesiones antiguas tienen un working_snapshot del formato experimental. Su original conservado permite verificarlas; no se presume compatibilidad universal de edición.
- Los precios distintos del mismo material en distintas recetas se preservan en Costeo. La planificación semanal debe revisarse por separado para referencias heterogéneas; no se cambia su motor en este lote.
- La base histórica también contiene PlanillaGrid con Handsontable/HyperFormula y clave de evaluación. El usuario indicó que no posee licencia. No se amplía ni se elige ese editor para el nuevo workspace; su sustitución pendiente requiere un lote propio que preserve los documentos. Esta entrega no certifica su licencia comercial.
- Las plantillas distinguen importadores existentes, pegado y formatos definidos sin cargador masivo. Tener un archivo XLSX no demuestra que exista una ruta de importación para todos sus campos.

## Recuperación y publicación

Referencias locales: backup/main-before-consolidation-20261104 y backup/iasa-before-consolidation-20261104. Artefactos anteriores: IASA dpl_Hp89jr2GyG8ZGA7wxrSWbHceQZyM, QA dpl_J69EHy8vP583EDuDCeCcSFSZL7yz. No se elimina historial.

La fuente operativa vigente se documenta en IASA-Y-QA.md; la evidencia de cada publicación registra commit, IDs de build y resultados. Una reversión mueve exclusivamente el alias afectado a un artefacto compatible; no revierte datos de negocio.
