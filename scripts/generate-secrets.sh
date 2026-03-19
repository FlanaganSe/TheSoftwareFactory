#!/usr/bin/env bash
set -euo pipefail

if [ -f .env ]; then
  echo ".env already exists. Remove it first if you want to regenerate."
  exit 1
fi

cp .env.example .env
sed -i'' -e "s/changeme_postgres/$(openssl rand -hex 16)/" .env
sed -i'' -e "s/changeme_redis/$(openssl rand -hex 16)/" .env
sed -i'' -e "s/changeme_temporal/$(openssl rand -hex 16)/" .env
sed -i'' -e "s/changeme_minio/$(openssl rand -hex 16)/" .env
sed -i'' -e "s/changeme_must_be_32_bytes_hex/$(openssl rand -hex 32)/" .env

echo "Generated .env with random secrets."
echo "Review and adjust before running 'docker compose up -d'."
