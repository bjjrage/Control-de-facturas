# Canonical ERP demo

Este directorio define el contrato estable del dataset para E2E. Los IDs son
deterministas, no contienen datos reales y se reutilizan entre ejecuciones para
que el seed sea idempotente.

El dataset cubre:

- tenant y usuario admin de prueba;
- proveedores, clientes, productos y stock;
- obras, presupuesto, avance y cronograma;
- compras, cotizaciones, órdenes e invoices de proveedor;
- ventas, factura y recibo;
- licitaciones, documentos y oferentes/competidores;
- certificados de obra;
- alertas derivadas de excepciones de factura y vencimientos documentales.

## Comandos

Desde la raíz del repositorio:

```powershell
npm run e2e:seed:plan
npm run e2e:seed
npm run e2e:reset
```

`e2e:seed:plan` no abre conexiones y solo valida el contrato y los assets.
`e2e:seed` requiere `E2E_SEED_MODE=local`, `E2E_SUPABASE_URL`,
`E2E_SERVICE_ROLE_KEY`, `E2E_TEST_EMAIL` y `E2E_TEST_PASSWORD`.
`e2e:reset` elimina únicamente las filas con IDs del dataset y las vuelve a
crear. El usuario de Auth y el tenant se conservan para que las sesiones de
Playwright no dependan de una cuenta descartable.

Por seguridad, el runner nunca usa `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY` ni `.env.local` como fallback. Rechaza el ref de
producción y solo acepta localhost/127.0.0.1 salvo que se habilite de forma
explícita un entorno de prueba no productivo.

## Assets

El manifiesto referencia fixtures binarios ya versionados en `mocks/` y
`lib/bim/__tests__/fixtures/`; no se duplican PDFs/XLSX/IFC. Los directorios
`tests/fixtures/documents`, `images` y `pdfs` documentan el espacio canónico
para nuevos assets sin mezclar evidencia temporal con fixtures funcionales.
