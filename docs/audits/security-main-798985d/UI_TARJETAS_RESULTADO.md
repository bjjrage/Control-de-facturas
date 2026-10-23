# Recuperación del estilo de tarjetas del Plan Semanal

Base del candidato: `0535e5a0b5d747056e16eed0881acb7a23e91203`, PR #41 contra main `798985d355fb8ed96796237e6f198c172db98709`.

Se recuperó el cambio solicitado por el usuario el 20/10/2026 y preservado sin commit en el worktree `weekly-block-card-style`. El componente recuperado coincide con esa fuente después de normalizar CRLF. No se integró su rama/base antigua ni su página de preview.

## Cambio

- `weekly-plan-section.tsx`: clases de lista/tarjeta, insignia del código y título compartidos con costeo; alineación y salto de línea del encabezado. El estado visual usa el porcentaje ya calculado para distinguir completo y pendiente.
- `weekly-plan-blocks.module.css`: compone la clase `row` de `costeo-checklist.module.css`, heredando fondo, borde, hover, foco, sombra, transición y temas. Solo adapta el contenedor para contenido de bloque.
- No se cambian cálculos, acciones, guardado, permisos, datos, API, dependencias o migraciones. El CSS original de costeo permanece intacto.

## Verificación

| Comprobación | Resultado |
|---|---|
| Build Next 16.4.2/Turbopack | PASS: compilación, TypeScript y 60 páginas estáticas; sin ruta de preview nueva. |
| Tests existentes de Plan Semanal | 5 archivos, **85 PASS**, 0 omitidos, 0 fallos. |
| ESLint del componente | 0 errores; 5 warnings de variables/imports no usados, exactamente los mismos del contenido anterior. |
| Flujo real QA | Login admin, página real de proyecto y carga de 10 bloques desde las acciones actuales; sin mocks de respuesta. Backend QA `kyiihlkncatojvlasoag`; sin guardar planes. |
| CSS compartido | La tarjeta y una fila real de Recetas APU en la pestaña Costeo comparten la misma clase compilada (`_20dr8q_row` en este build). No se depende de conservar nombres de módulos sin minificar. |
| Escritorio 1366×900 | Hover y foco en temas original/claro: fondo, sombra, borde y desplazamiento; se espera el fin real de las transiciones CSS. |
| Interacción | Enter sobre Planificar este bloque abre el editor existente y permite cerrarlo, sin persistir cambios. |
| Móvil 390×844 | Tarjeta y acción dentro del viewport, foco visible y contenido en varias líneas. No se certifica ausencia de overflow de toda la app: ver límite abajo. |
| Errores observados | Sin pageerrors ni respuestas locales 5xx en las verificaciones finales. |
| Alcance | Archivos de seguridad y migraciones sin delta respecto de 0535e5a0; sin commits del scanner antiguo. |

## Límite móvil observado

La página completa mide 470 px en un viewport de 390 px por controles existentes fuera de las tarjetas (cabecera/selector de estado y fechas). Al ocultar temporalmente toda la lista de bloques en el DOM para aislar su contribución, el ancho sigue siendo 470 px. La tarjeta y su botón permanecen dentro del viewport. Ese problema de la pantalla completa no se corrigió dentro de este cambio de estilo.

Los primeros intentos del harness asumían nombres CSS sin minificar y tiempos fijos de transición; se corrigió la observación del test, sin alterar el código de UI para hacerlos pasar. Se conservan esos registros y el diagnóstico del overflow. El resultado final combina las comprobaciones iniciales aprobadas y las finales de clase compartida, ambos temas y móvil; no se presenta una corrida inicial fallida como aprobada.

## Evidencia y publicación

Evidencia privada local en `../security-fix-validation`: `cards-build.log`, `cards-vitest.json`, `cards-eslint.log`, `cards-eslint-base.log`, `cards-browser-initial.json`, `cards-browser-before-mobile.json`, `cards-browser-final.json`, `cards-desktop-final.png`, `cards-light-hover.png`, `cards-mobile.png` y los harness de navegador. No se versionan credenciales ni archivos de sesión.

La validación anterior de las dos migraciones y los nueve controles de seguridad conserva su SHA d85bfb4 y su alcance; no se repitió como E2E completo por un cambio exclusivamente visual. Este commit se agrega al PR #41. Main, producción y autodeploy permanecen intactos; sin merge, deploy ni cambios en los otros proyectos. El worktree original de tarjetas y el del scanner se preservan.
