# Workspace E2E suites

La base canónica queda preparada para suites independientes y serializables:

1. `admin-dashboard.spec.ts`: KPIs, atención, compras, ventas y recibos.
2. `operative-dashboard.spec.ts`: selector de obra, portfolio, presupuesto,
   avance y cronograma.
3. `tenders-dashboard.spec.ts`: KPIs de licitaciones, readiness, documentos y
   competidores.

Cada suite debe consumir los IDs del manifiesto canónico y preparar su estado
con `npm run e2e:reset`, en vez de depender de datos remotos preexistentes.
Scanner permanece fuera de esta base y conserva sus suites actuales.
