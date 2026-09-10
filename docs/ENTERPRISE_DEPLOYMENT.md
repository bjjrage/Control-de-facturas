# ==============================================================================
# GUÍA OPERATIVA DE DESPLIEGUE EMPRESARIAL (GATE 21)
# Procedimientos de Alta Disponibilidad, Respaldo y Rotación de Secretos
# ==============================================================================

## 1. REQUISITOS MÍNIMOS DEL SERVIDOR
* **CPU**: 4 vCPUs (x86_64)
* **RAM**: 16 GB ECC
* **Almacenamiento**: 250 GB SSD NVMe
* **SO**: Ubuntu Server 22.04 LTS o Red Hat Enterprise Linux 9

---

## 2. PUESTA EN MARCHA RÁPIDA (DOCKER COMPOSE)

```bash
# 1. Clonar repositorio y configurar variables de entorno
cp .env.example .env.production
nano .env.production

# 2. Levantar el stack completo aislado
docker compose -f docker-compose.enterprise.yml --env-file .env.production up -d

# 3. Verificar estado de salud de los contenedores
docker compose -f docker-compose.enterprise.yml ps
```

---

## 3. PROCEDIMIENTO DE BACKUP Y RESTORE

### Backup Diario Automatizado de PostgreSQL:
```bash
# Exportar dump comprimido con consistencia transaccional
docker exec -t construct_postgres pg_dump -U construct_admin -F c -b -v -f /var/lib/postgresql/data/backup_$(date +%Y%m%d).dump construct_intelligence
```

### Procedimiento de Disaster Recovery:
```bash
# 1. Detener servicios de aplicación
docker compose -f docker-compose.enterprise.yml stop web

# 2. Restaurar base de datos
docker exec -i construct_postgres pg_restore -U construct_admin -d construct_intelligence -v --clean /var/lib/postgresql/data/backup_YYYYMMDD.dump

# 3. Reiniciar aplicación
docker compose -f docker-compose.enterprise.yml start web
```

---

## 4. ROTACIÓN DE CLAVES Y SECRETOS
* Las credenciales de la base de datos y llaves de cifrado deben rotarse semestralmente modificando el archivo `.env.production` y ejecutando `docker compose -f docker-compose.enterprise.yml up -d --force-recreate`.
