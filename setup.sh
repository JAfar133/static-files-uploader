#!/usr/bin/env bash
# Создаёт .env: логин и bcrypt-хэш пароля админки.
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] && { echo ".env уже существует — удалите его, чтобы настроить заново."; exit 1; }

read -rp "Логин админки [admin]: " ADMIN_USER; ADMIN_USER=${ADMIN_USER:-admin}
read -rsp "Пароль админки: " PASS; echo

HASH=$(docker run --rm caddy:2 caddy hash-password --plaintext "$PASS")

cat > .env <<EOF
ADMIN_USER=$ADMIN_USER
ADMIN_PASS_HASH='$HASH'
MAX_UPLOAD_MB=500
EOF
chmod 600 .env
echo "Готово. Запуск: docker compose up -d --build"
