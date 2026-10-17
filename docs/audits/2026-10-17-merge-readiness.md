# Preparación de integración — 17/10/2026

**Dictamen actual: NO-GO para merge a `main`.** Este documento registra preparación y límites comprobables; no autoriza despliegue ni cambios en producción.

## Alcance preparado

- Base Git: `codex/compras-ventas-integration` (`eb29ff4`), ocho commits delante de `main` al iniciar esta revisión. El trabajo nuevo está en `codex/compras-ventas-merge-prep` dentro de una copia aislada; el checkout principal y el worktree histórico quedaron intactos.
- Se incorporaron los cambios locales recientes de ayuda emergente, tarjetas y temas Claro/Original para someterlos a la batería de integración. Los selectores nativos restantes de recepción, adjudicación y condiciones de pago se migraron al control ERP compartido.
- `20261017182341_audit_financial_guards.sql` versiona el paquete financiero que ya fue ejecutado y verificado en la base aislada `kyiihlkncatojvlasoag`. La migración aún no se ejecutó mediante el historial de migraciones: antes de desplegar se debe reconciliar la versión aplicada del preview con el ledger y comprobar la definición esperada. Nunca se debe aplicar ciegamente una segunda vez sobre el preview.
- `20261017182538_warehouse_portal_external_actor.sql` corrige R02: el sponsor interno conserva la autoría de la delegación, mientras que la confirmación y el movimiento no suplantan su identidad. La metadata identifica el portal y al receptor físico. La función exige enlace activo, contexto de empresa/OC/obra y clave idempotente. Este SQL nuevo **solo se probó localmente**, no se aplicó al preview ni a producción.

## Verificaciones

- Prueba SQL local de controles financieros: 17/17; prueba de recepciones con funciones/triggers canónicos y actor externo: 19/19. Incluyen reintento sin duplicar stock, enlace revocado y preservación del portal de un solo uso.
- TypeScript y lint enfocado: sin errores. Las pruebas de interfaz se ajustaron a los textos ahora alojados en ayudas emergentes; los controles y las alertas funcionales siguen presentes.
- Batería completa local: **2281/2281 pruebas ejecutadas PASS**, 16 omitidas por configuración (210 archivos PASS, dos omitidos). Build de producción Next 16.3.8 con webpack: compilación, TypeScript y 59 páginas estáticas PASS. La compilación Turbopack del clon falla porque `node_modules` es una junction que apunta fuera de la raíz de este checkout; el build webpack permite validar las fuentes sin cambiar el proyecto.
- Dos estados Vercel fallidos de `eb29ff4` pertenecen a los proyectos `control-facturas-surface-recovery` y `control-scanner-detection-v2`: ambos fallan antes de compilar por configuración `[MISSING_SERVICES]` (framework `services` sin servicios declarados). El contexto `control-de-facturas` figura como ignorado. No se cambiaron proyectos Vercel.

## Bloqueos de aceptación

El informe [2026-10-17-compras-ventas-cierre.txt](2026-10-17-compras-ventas-cierre.txt) conserva las brechas de la auditoría original. Siguen sin cierre verificable C06 (PDF escaneado), C07 (atomicidad de factura manual), V05 (atomicidad venta y reintento de cobro), R03 (fallo Storage real), R04 (UI de depósito central), V06 (ataque multiempresa real), OT01/OT02 (transiciones, cantidades y cancelaciones), matriz de roles/superficies y repetición de ventas con el esquema final. La reparación R02 local no cierra los demás puntos.

**Criterio para pasar a GO:** completar las pruebas adversariales y correcciones anteriores en preview aislado; aplicar y verificar allí la nueva migración R02 con autorización específica; reconciliar la migración financiera con el historial sin repetirla; tener build y batería completos en verde y una revisión final del diff. Solo después se propone merge a `main` y rollout controlado.
