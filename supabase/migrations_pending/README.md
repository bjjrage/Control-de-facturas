# Migraciones PENDIENTES (no aplicadas)

Este directorio contiene propuestas de migración **versionadas pero NO aplicadas**.
Supabase CLI solo aplica `supabase/migrations/` — nada de aquí se ejecuta con
`supabase db push`, ni en Production, ni en Preview, ni en instancias compartidas.

## Contenido

| Archivo | Estado | Descripción |
|---|---|---|
| `20261010000000_invoice_item_match_atomic_PENDING.sql` | **PENDING** | RPCs `create_invoice_item_match` + `correct_invoice_item` y helpers de correspondencia (H2/H3). Requiere aprobación + deploy para tener efecto. El código TS actual NO llama a estas RPCs. |

## Verificación realizada (sin aplicar en remoto)

- Sintaxis y lógica secuencial sobre PostgreSQL real local (PGlite, WASM):
  `test/invoice-item-match-rpc-pglite.test.ts` — invariantes documental/OC/
  relacional, idempotencia, tenant isolation, freeze por estado, rollback ante
  error, corrección in-place con revalidación. Veredicto en el spec.
- La spec filtra las líneas `REVOKE`/`GRANT`/`CREATE EXTENSION`/`ALTER ... OWNER`
  (roles/extensiones del entorno real) e inyecta shims mínimos (`auth.uid`,
  `auth.role`, `extensions.unaccent` vía `translate`). La lógica bajo prueba es
  byte-idéntica a la del archivo de migración.

## Verificación BLOCKED (concurrencia real con locks)

Requiere PostgreSQL multitone local (binarios `postgres` o docker daemon
funcional; ambos ausentes en este entorno). Pasos para el revisor/CI con PG real:

```bash
# 1. Levantar PG efímero (NO Producción, NO Preview, sin recursos facturables)
docker run -d --rm --name pg-verify -e POSTGRES_PASSWORD=pg -p 54331:5432 postgres:16
# 2. Crear schema mínimo (tablas del spec + trigger canónico) y aplicar la migración
psql "postgresql://postgres:pg@localhost:54331/postgres" -f <schema-minimo>.sql
psql "postgresql://postgres:pg@localhost:54331/postgres" \
  -f supabase/migrations_pending/20261010000000_invoice_item_match_atomic_PENDING.sql
# 3. Concurrencia: 2 sesiones, OC 3000 / facturado 2000 / remanente 1000,
#    ambas intentan imputar 800 en simultáneo (una debe fallar con
#    'remanente'; el total confirmado nunca supera 3000):
#    sesión A: BEGIN; SELECT create_invoice_item_match(...800...); -- retener abierta
#    sesión B: BEGIN; SELECT create_invoice_item_match(...800...); -- debe bloquear y luego fallar o viceversa
#    COMMIT ambas; verificar SUM(quantity_matched) <= 3000.
# 4. Inserción vs desvinculación: retener create abierta, DELETE del vínculo en
#    otra sesión, COMMIT: el match debe abortar ('sin vínculo') o el unmatch
#    debe esperar y converger por trigger.
# 5. Inserción vs aprobación: retener create abierta, mark_invoice_apto_para_pago
#    en otra sesión: exclusión mutua por lock de invoices.
# 6. Error a mitad de correct_invoice_item (cantidad inválida tras UPDATE):
#    verificar rollback total (línea y matches intactos).
# 7. Tenant A vs B y rol no autorizado: deben fallar con 42501/mensajes.
# 8. docker stop pg-verify  (efímero: nada persiste)
```

Criterio: ningún estado confirmado supera cantidades permitidas; sin esto,
**NO declarar ATOMICITY VERIFIED**.

## Cutover (post-aprobación, fuera de este batch)

1. Revisión y `ALTER` de este archivo a `supabase/migrations/` con timestamp real
   (quitar sufijo `_PENDING` y este README).
2. Aplicar en staging → suite completa + E2E focalizada.
3. Cambiar `createInvoiceItemMatch`/`insertValidatedItemMatches` a `supabase.rpc`
   (TS como pre-chequeo; la RPC como autoridad) + reintento único ante `40P01`.
4. Aplicar en producción en ventana de bajo tráfico (locks `FOR UPDATE` breves;
   sin cambio de RLS ni de triggers).

## Rollback

No-aplicar revierte todo (el runtime no referencia estas funciones). Si ya se
aplicó: `DROP FUNCTION` de las 6 funciones + re-deploy del código TS previo
(el código de esta branch no depende de ellas).
