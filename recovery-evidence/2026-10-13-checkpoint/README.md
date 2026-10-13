# Checkpoint de preview - 13/10/2026

Rama de pruebas: recovery/compras-ventas-approved. No es una entrega aprobada para main.

Manana: crear rama limpia desde main actualizado y portar solo Compras/Ventas; no mergear el arbol historico completo. Mantener Operativo y contratos actuales. Probar de nuevo ambos ciclos y pagos antes de integrar.

La preview web corrio desde erp-before-live; el worker canonico desde erp-recovery. historical-runtime-vs-recovery.patch registra las diferencias actuales de cuatro archivos de facturas entre ambos arboles para preservar evidencia. NO aplicar este parche sobre main: incluye diferencias historicas y no es un paquete de migracion.

preview-invoice-worker.cjs.txt es copia documental del launcher local. No contiene credenciales. Sus rutas se resuelven desde el directorio padre local original; no ejecutar directamente desde este checkpoint. Usa las credenciales ignoradas de erp-recovery/.env.local y rechaza cualquier host distinto de kyiihlkncatojvlasoag.supabase.co.

Los PDF son fixtures sinteticos sin validez fiscal. Los PNG muestran la preview aislada y datos sinteticos.

Pruebas completadas: factura individual autoextraida via OpenAI; aviso proveedor y footer accesible; reconciliacion por campo 1000 vs 1200 bloqueada; version corregida llego a preview de OC; lote real de 3 PDF: 1 factura conciliada a OC-2026-0005, 1 duplicado bloqueado, 1 proveedor desconocido a revision. Detalles, IDs y limitaciones en RECOVERY_HANDOFF.md.

No pagos ejecutados. No ciclo completo aprobado. Compiling/rendering de la preview vieja sigue sin diagnostico definitivo. Cambio de prewarm dev de AppShell se conserva en rama de prueba, no trasladar automaticamente a main.

No se incluyen .env, claves OpenAI/Supabase, cookies ni sesiones.