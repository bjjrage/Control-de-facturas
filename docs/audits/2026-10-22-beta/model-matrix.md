# Comparacion preliminar del extractor — QA — 22/10/2026

42 llamadas reales; mismo extractor, prompts y esquema. El lector predeterminado permanece sin cambios. El corpus es sintetico. No constituye aprobacion del cambio de modelo.

| Modelo | Documentos sin diferencias en campos puntuados | Latencia media | Costo calculado USD |
|---|---:|---:|---:|
| baseline | 13/14 | 3.14 s | 0.048021 |
| gpt-6-luna | 14/14 | 4.31 s | 0.004746 |
| gpt-6.1-sol | 14/14 | 4.09 s | 0.087456 |

| Documento | Modelo efectivo | Resultado | Diferencias | Tiempo | Costo USD |
|---|---|---|---|---:|
| iva10-pdf | gpt-4o-mini | PASS | 0 | 5.45 s | 0.000260 |
| iva10-pdf | gpt-6-luna | PASS | 0 | 3.02 s | 0.000249 |
| iva10-pdf | gpt-6.1-sol | PASS | 0 | 4.15 s | 0.005013 |
| iva10-imagen | gpt-4o-mini | PASS | 0 | 3.08 s | 0.005770 |
| iva10-imagen | gpt-6-luna | PASS | 0 | 5.31 s | 0.000617 |
| iva10-imagen | gpt-6.1-sol | PASS | 0 | 5.19 s | 0.012164 |
| iva5-pdf | gpt-4o-mini | PASS | 0 | 3.97 s | 0.000174 |
| iva5-pdf | gpt-6-luna | PASS | 0 | 3.32 s | 0.000127 |
| iva5-pdf | gpt-6.1-sol | PASS | 0 | 3.84 s | 0.001738 |
| iva5-imagen | gpt-4o-mini | PASS | 0 | 2.86 s | 0.005771 |
| iva5-imagen | gpt-6-luna | PASS | 0 | 6.73 s | 0.000504 |
| iva5-imagen | gpt-6.1-sol | PASS | 0 | 5.41 s | 0.009444 |
| exento-pdf | gpt-4o-mini | PASS | 0 | 2.16 s | 0.000173 |
| exento-pdf | gpt-6-luna | PASS | 0 | 2.13 s | 0.000115 |
| exento-pdf | gpt-6.1-sol | PASS | 0 | 2.90 s | 0.001723 |
| exento-imagen | gpt-4o-mini | PASS | 0 | 3.13 s | 0.005771 |
| exento-imagen | gpt-6-luna | PASS | 0 | 6.59 s | 0.000514 |
| exento-imagen | gpt-6.1-sol | PASS | 0 | 4.30 s | 0.009444 |
| decimales-pdf | gpt-4o-mini | PASS | 0 | 2.93 s | 0.000177 |
| decimales-pdf | gpt-6-luna | PASS | 0 | 2.86 s | 0.000125 |
| decimales-pdf | gpt-6.1-sol | PASS | 0 | 3.27 s | 0.001816 |
| decimales-imagen | gpt-4o-mini | PASS | 0 | 3.22 s | 0.005773 |
| decimales-imagen | gpt-6-luna | PASS | 0 | 5.70 s | 0.000497 |
| decimales-imagen | gpt-6.1-sol | PASS | 0 | 5.29 s | 0.009504 |
| sin-total-pdf | gpt-4o-mini | FAIL | items.0.subtotal: esperado null, observado 20000 | 2.72 s | 0.000172 |
| sin-total-pdf | gpt-6-luna | PASS | 0 | 3.06 s | 0.000147 |
| sin-total-pdf | gpt-6.1-sol | PASS | 0 | 3.37 s | 0.001681 |
| sin-total-imagen | gpt-4o-mini | PASS | 0 | 4.20 s | 0.005770 |
| sin-total-imagen | gpt-6-luna | PASS | 0 | 5.61 s | 0.000494 |
| sin-total-imagen | gpt-6.1-sol | PASS | 0 | 4.46 s | 0.009404 |
| inconsistente-inyeccion-pdf | gpt-4o-mini | PASS | 0 | 2.60 s | 0.000177 |
| inconsistente-inyeccion-pdf | gpt-6-luna | PASS | 0 | 2.08 s | 0.000135 |
| inconsistente-inyeccion-pdf | gpt-6.1-sol | PASS | 0 | 3.12 s | 0.001803 |
| inconsistente-inyeccion-imagen | gpt-4o-mini | PASS | 0 | 3.49 s | 0.005770 |
| inconsistente-inyeccion-imagen | gpt-6-luna | PASS | 0 | 6.01 s | 0.000488 |
| inconsistente-inyeccion-imagen | gpt-6.1-sol | PASS | 0 | 5.10 s | 0.009454 |
| blanco | gpt-4o-mini | PASS | 0 | 2.31 s | 0.005735 |
| blanco | gpt-6-luna | PASS | 0 | 3.12 s | 0.000270 |
| blanco | gpt-6.1-sol | PASS | 0 | 3.18 s | 0.005354 |
| C06-escaneo-sintetico | gpt-4o | PASS | 0 | 1.83 s | 0.006528 |
| C06-escaneo-sintetico | gpt-6-luna | PASS | 0 | 4.85 s | 0.000464 |
| C06-escaneo-sintetico | gpt-6.1-sol | PASS | 0 | 3.66 s | 0.008914 |

Limitaciones:
- Corpus totalmente sintetico, incluido C06 rasterizado. No hay manuscritos, fotos reales ni multipagina revisados por una persona.
- Se puntuan RUC, numero, fecha, moneda, subtotal, IVA, total, cantidad/precio/importe y longitud de lineas; no todos los campos textuales.
- La extraccion transcribe inconsistencias; no autoriza ni valida documentos por si misma. Faltan negativos de negocio y flujos 15/16/17 con candidato app/worker.
- No se modifica el lector ni se aprueba una migracion por esta muestra.

La linea base invento el importe de linea 20.000 en sin-total-pdf, donde solo estaba impreso en la cabecera. Luna y Sol conservaron null. No inferir que el resto de las protecciones de negocio fueron aprobadas por estos resultados.

Luna queda como candidato preferido para completar QA. Sol no demostro una mejora adicional en esta muestra que justifique habilitar segunda lectura.

[Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [4o](https://developers.openai.com/api/docs/models/gpt-4o), [4o mini](https://developers.openai.com/api/docs/models/gpt-4o-mini), [Responses API](https://developers.openai.com/api/docs/guides/migrate-to-responses).
