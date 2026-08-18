#!/bin/bash
# Copia o banco de PRODUÇÃO (Supabase) para o banco LOCAL (Docker porta 5433).
# Somente lê da prod — não altera nada lá.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROD_URL="$(grep -E '^SUPABASE_DATABASE_URL=' "$SCRIPT_DIR/.env" | cut -d '=' -f2-)"
if [ -z "$PROD_URL" ]; then
  echo "ERRO: SUPABASE_DATABASE_URL não encontrada em $SCRIPT_DIR/.env"
  exit 1
fi
LOCAL_CONTAINER="fisio_postgres_dev"
LOCAL_USER="fisio"
LOCAL_DB="fisio_dev"
DUMP_FILE="/tmp/fisio_prod_dump.sql"

echo "==> Verificando container local..."
if ! docker ps --format '{{.Names}}' | grep -q "^${LOCAL_CONTAINER}$"; then
  echo "ERRO: Container '${LOCAL_CONTAINER}' não está rodando. Execute: docker compose up -d"
  exit 1
fi

echo "==> Fazendo dump da prod (usando postgres:17-alpine para compatibilidade)..."
docker run --rm postgres:17-alpine pg_dump \
  --no-owner --no-acl --clean --if-exists \
  "$PROD_URL" > "$DUMP_FILE"

echo "==> Restaurando no banco local..."
docker exec -i "$LOCAL_CONTAINER" psql \
  -U "$LOCAL_USER" -d "$LOCAL_DB" < "$DUMP_FILE"

rm -f "$DUMP_FILE"

echo ""
echo "✅ Dump concluído! Banco local sincronizado com a prod."
echo "   Para usar: npm run start:dev:local"
