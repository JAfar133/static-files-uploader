#!/usr/bin/env bash
# САМОСТОЯТЕЛЬНОЕ развёртывание: Static Hub сам занимает порты 80/443 и сам получает HTTPS-сертификат.
# Для чистого сервера, где нет другого веб-сервера.
#
#   ./scripts/deploy-standalone.sh --domain static-hub.example.com [--user admin] [--pull] [--skip-dns-check]
#
# Пароль админки: спросит в терминале (Enter — сгенерировать) либо возьмёт ADMIN_PASSWORD из окружения.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

DOMAIN="" PULL=0 SKIP_DNS=0 ADMIN_USER_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:?укажите домен}"; shift 2 ;;
    --user) ADMIN_USER_ARG="${2:?укажите логин}"; shift 2 ;;
    --pull) PULL=1; shift ;;
    --skip-dns-check) SKIP_DNS=1; shift ;;
    -h|--help) sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fail "неизвестный параметр: $1" ;;
  esac
done
[ -n "$DOMAIN" ] || DOMAIN="$(get_env_value SITE_ADDRESS)"
case "$DOMAIN" in ""|:*) fail "укажите домен: --domain static-hub.example.com" ;; esac

require_docker
ensure_ports_free
[ "$SKIP_DNS" = 1 ] || check_dns "$DOMAIN"
[ "$PULL" = 1 ] && pull_code

set_env_value SITE_ADDRESS "$DOMAIN"
set_env_value COMPOSE_FILE "docker-compose.yml:docker-compose.standalone.yml"
ensure_admin_credentials

log "Собираю и запускаю (режим: самостоятельный)"
compose up -d --build --remove-orphans

log "Жду HTTPS (выпуск сертификата занимает до минуты)"
for _ in $(seq 1 45); do
  code="$(curl -sk -o /dev/null -w '%{http_code}' --max-time 5 "https://$DOMAIN/" || true)"
  if [ "$code" = "401" ]; then
    log "Готово: https://$DOMAIN (запрос без пароля отвечает 401 — админка защищена)"
    exit 0
  fi
  sleep 2
done
compose logs --tail 20 hub
fail "https://$DOMAIN не отвечает как ожидалось (последний код: ${code:-нет}). Логи выше."
