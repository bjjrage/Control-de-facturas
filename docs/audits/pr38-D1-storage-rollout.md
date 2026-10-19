# D1 — formatos del portal

El portal acepta únicamente JPEG, PNG, WEBP, HEIC y PDF, conforme a la configuración de `warehouse-evidence` observada por la revisión en la branch aislada. No se amplió el bucket.

Antes de publicar en producción, una persona autorizada deberá verificar que `warehouse-evidence.allowed_mime_types` permite esos cinco formatos y que `file_size_limit` coincide con los 20 MiB anunciados. Esta tarea no consultó ni modificó producción. Si difiere, revisar el despliegue antes de ejecutarlo; no ampliar permisos automáticamente.
