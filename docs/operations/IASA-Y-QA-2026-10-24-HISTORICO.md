# IASA estable y pruebas aisladas

Estado revisado: 24 de octubre de 2026. Proyecto autorizado: `control-de-facturas` y su worker. Una sola copia de trabajo, en `main`; no se crearon ramas ni worktrees.

## Direcciones y datos

| Uso | Dirección | Base de datos |
| --- | --- | --- |
| IASA, datos reales | https://control-de-facturas-iasa.vercel.app | Producción: `ezucivipgmbvamhugkbj` |
| Dirección estable anterior, misma versión que IASA | https://control-de-facturas-bay.vercel.app | Producción: `ezucivipgmbvamhugkbj` |
| QA remoto | https://control-de-facturas-git-main-marceloechauri-4623s-projects.vercel.app | QA existente: `kyiihlkncatojvlasoag` |
| Desarrollo local | http://127.0.0.1:3042 | QA existente: `kyiihlkncatojvlasoag` |

IASA y bay apuntan al mismo despliegue de Production `dpl_GnayEtbwrUs6VyqpHqXCvF2xc4ey`, commit `9dba47cec8658b0670f26834690f529f1c74b5e8`: retiro del logo superior del login publicado manualmente con autorización expresa el 24 de octubre. Conserva el retiro del instructivo de `cd7344c4`. La autorización de esta publicación incluye ambas direcciones estables. Se comprobaron ambos aliases y que QA conserva su despliegue Preview separado.

QA remoto quedó READY en `dpl_4eX85rpaaJRhRqcGnHiqNHxFdvaQ`, con el mismo commit del retiro del logo, usando el entorno Preview. Los tres accesos remotos de la tabla se comprobaron en `/login`: HTTP 200, formulario presente y logo superior ausente. En la publicación anterior del retiro del instructivo se verificaron en navegador autenticado ambos entornos: cero enlaces a `/instructivo`, redirección de esa ruta a `/dashboard` y conservación del acceso de superadministrador. Durante la separación inicial las variables Production se compararon antes y después sin diferencias.

La dirección IASA identifica la web estable: no crea una empresa ni otorga permisos. La administradora debe tener su cuenta vinculada exclusivamente a su empresa mediante la administración normal de usuarios.

Acceso personal a QA preparado el 24 de octubre: la cuenta de Marcelo Echauri está activa, con rol `admin` e indicador `is_super_admin=true`, vinculada a la empresa sintética existente de QA. El indicador se corrigió después de haberla creado erróneamente como administrador de empresa. Se renovó la sesión y se verificó en la web `/empresas`, con los controles `Nueva empresa` y `Agregar usuario` y el estado `Superadmin protegido` en su cuenta. Las credenciales no se guardan en este informe. No se modificaron cuentas de producción.

Comprobación de producción solo en lectura: Marcelo conserva el indicador de superadministrador. La empresa `Iasa` ya existe y tiene una administradora activa llamada `Magy Merlo`, con cuenta Auth confirmada y un ingreso registrado el 24 de octubre. Esa cuenta no existe en QA; separar los entornos no copia usuarios ni empresas reales. Para gestionar empresas y sus usuarios se usa `/empresas` como superadministrador; el administrador de una empresa gestiona su equipo en `/users`.

## Separación configurada

- `.env.local` usa únicamente URL y credenciales de Supabase QA. Se comprobó también el proyecto contenido en la clave de servicio, sin mostrarla.
- La CLI de Supabase quedó enlazada a QA (`supabase/.temp/project-ref`), mediante `supabase link`, sin ejecutar migraciones.
- Las variables generales de Vercel Preview usan URL, clave pública y clave de servicio de QA. Development tiene la URL y clave pública de QA; la clave privada de desarrollo permanece en el archivo local ignorado por Git.
- `NEXT_PUBLIC_APP_URL` de Preview apunta a la dirección QA y Development a `http://127.0.0.1:3042`.
- Las variables Production de Vercel no se modificaron.
- Supabase producción no tiene repositorio GitHub ni integración Vercel conectados en Settings > Integrations. No se habilitó ninguna integración.
- Se conservaron los archivos existentes de Storage y los usuarios de producción. No se copiaron datos reales a QA.

## Workers

Proyecto Railway existente: `control-de-facturas-worker`, ID `1109edd5-e5e5-4c42-a7e3-43d1c2646032`.

| Uso | Entorno | Servicio | Base |
| --- | --- | --- | --- |
| IASA / producción | `production`, `10ba6675-b581-408e-9a9a-4c728827cbf4` | `worker`, `8f8d5d57-9c79-451a-b8c3-42020d4bdd80` | Producción |
| Pruebas | `qa`, `9c1a4a6f-28c1-445e-b996-93fce5b574c4` | `worker-qa`, `3c59e7f7-1d0f-4649-8f7c-e383f70f13fb` | QA |

El autodeploy del worker de producción está desactivado. Su proceso existente se conservó; no se reinició ni redesplegó. El worker QA se creó dentro del mismo proyecto, con las credenciales de QA y el uso de la clave OpenAI existente expresamente autorizado por el usuario.

Worker QA verificado online durante la separación inicial: despliegue `8d5e0aa2-44d7-4a90-bb34-141aea2efc88`, desde `main` / `af0f0ff7b4f9b14d653c89f9c42913ba5de0d26f`. El push posterior del retiro obtuvo el check `control-de-facturas-worker - worker-qa` en success; no se hicieron operaciones manuales de Railway para ese retiro.

Una tarea temporal con ruta inválida fue consumida por ese worker y quedó en `needs_review`, con un intento y el rechazo esperado de la ruta. Se comprobó el mismo ID en los logs de Railway y en la base QA. Se eliminó solamente ese registro de prueba. No se subió un documento real ni se llamó a OpenAI durante esta prueba.

El archivo del repositorio `railway.json` determina los comandos efectivos del worker (`npm run worker`). La separación comprobada depende de las credenciales y bases distintas; no debe suponerse que una configuración de comando en el panel prevalece sobre ese archivo.

## Publicación manual de IASA

Vercel conserva `autoAssignCustomDomains=false`. La regla `Remediation 3 legacy deployment protection` se mantuvo activa, con los cuatro hostnames anteriores y únicamente `control-de-facturas-iasa.vercel.app` agregado. Los despliegues antiguos no se habilitaron en general.

**Autorizado y aplicado el 24 de octubre de 2026:** el Ignored Build Step omite los builds automáticos de Production desde main. Se verificó la regla persistida en el panel de Vercel y que los aliases IASA y bay siguen apuntando al despliegue estable, mientras el alias de QA conserva su despliegue Preview separado. No se generó ningún build, push ni despliegue para aplicar esta configuración.

Regla aplicada:

```sh
if [ "$VERCEL_ENV" = "production" ]; then echo "IASA estable: publicacion manual"; exit 0; else bash scripts/vercel-ignore-build.sh; fi
```

Los pushes a main no publican IASA ni generan automáticamente un build web de QA. Los builds manuales de QA usan el proyecto Vercel existente y un SHA publicado de main. En `POST /v13/deployments`, el esquema oficial establece Preview cuando se omite `target`; el literal `target: "preview"` es rechazado por la API. Verificar el entorno resultante, las variables de QA y el SHA antes de probar. Nunca promover un despliegue de QA como producción.

Para actualizar IASA hace falta una autorización explícita de publicación y un build de Production con sus propias variables, omitiendo puntualmente esta regla de exclusión y comprobando el SHA antes de promoverlo. Coordinar también la versión del worker de producción cuando el cambio lo requiera. Los datos reales siguen funcionando con normalidad en la versión estable.

Publicación posterior autorizada: se hizo commit y push únicamente de los diez archivos del retiro del instructivo (`cd7344c4`). Los manuales HTML y los otros cambios pendientes quedaron fuera del commit, respaldados y conservados por hash. TypeScript, lint y once escenarios de navegación PASS; builds Preview y Production READY. La excepción de main duró solo el push; se restauró y comparó la protección completa, idéntica al estado anterior. Los hooks permanentes siguen en `.githooks`. IASA conserva publicaciones manuales y builds automáticos de Production omitidos. Los checks de la app y worker QA quedaron en success; los dos checks fallidos de proyectos excluidos no se modificaron. No hubo migraciones, cambios a usuarios ni escrituras de negocio en esta publicación.

La conexión del plugin Railway con Codex sigue fallando aun después de aceptar su autenticación. Las operaciones verificadas de esta tarea se completaron por la sesión web existente. No insistir en el ciclo de autenticación del plugin.

Publicación del logo: commit `9dba47ce`, únicamente `app/(auth)/login/page.tsx`, cuatro líneas eliminadas. Los demás contenidos pendientes se conservaron por hash y quedaron fuera de ese commit. La protección completa de main se restauró inmediatamente tras el push y se comparó idéntica al estado previo. Builds QA y Production READY; checks de app y worker QA success; sin errores de runtime encontrados en la comprobación posterior del despliegue de producción. No se hicieron migraciones, cambios a credenciales, escrituras de negocio ni operaciones manuales sobre Railway.

## Cierre de documentación

El usuario autorizó incorporar a main los siete archivos de manuales, catálogo, generador, estilos, manifest y este informe. La base funcional de los HTML se actualiza a `9dba47ce`, que ya incorpora ambos retiros; las futuras diferencias de fuentes siguen requiriendo revisión. Este cierre guarda documentación y herramientas offline: no publica builds manuales ni promueve despliegues. IASA y bay conservan `dpl_GnayEtbwrUs6VyqpHqXCvF2xc4ey`; main puede avanzar con documentación sin cambiar la versión estable. La excepción de GitHub se limita al push y debe restaurar inmediatamente la protección completa; los hooks permanentes permanecen en `.githooks`.

Validación documental PASS: 59 fichas, 9 circuitos, 76 pantallas y 19 herramientas de obra, sin páginas pendientes. Generación reproducible; contenido instructivo conservado; enlaces, filtros, móvil de 390 px, impresión y lectura sin JavaScript verificados; cero errores JS y cero solicitudes de red. Sintaxis, lint y revisión de espacios PASS. Evidencia fuera del repositorio en `docs-close-20261024/`. El cierre se identifica en Git por el commit documental que incorpora estos siete archivos; no debe confundirse con la versión estable de la app.
