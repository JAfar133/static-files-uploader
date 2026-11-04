#!/usr/bin/env bash
# РАЗВЁРТЫВАНИЕ ЗА ОБЩИМ CADDY (edge): Static Hub не занимает порты, HTTPS выпускает общий Caddy из репозитория
# vpnserver-infrastructure. Для сервера, где уже работают другие сервисы (80/443 заняты).
#
#   ./scripts/deploy-edge.sh [--user admin] [--pull]
#
# Предварительно должна существовать docker-сеть `edge` (создаёт vpnserver-infrastructure: docker compose up --no-start).
# После запуска сайт описывается в общем Caddy файлом caddy/sites/static-hub.caddy (он уже есть в том репозитории).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

PULL=0 ADMIN_USER_ARG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --user) ADMIN_USER_ARG="${2:?укажите логин}"; shift 2 ;;
    --pull) PULL=1; shift ;;
    -h|--help) sed -n '2,8p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fail "неизвестный параметр: $1" ;;
  esac
done

require_docker
docker network inspect edge >/dev/null 2>&1 \
  || fail "не найдена docker-сеть 'edge'. Сначала подготовьте общий Caddy: репозиторий vpnserver-infrastructure, 'docker compose up --no-start'."
[ "$PULL" = 1 ] && pull_code

set_env_value SITE_ADDRESS ":80"
set_env_value COMPOSE_FILE "docker-compose.yml:docker-compose.edge.yml"
ensure_admin_credentials

log "Собираю и запускаю (режим: за общим Caddy)"
compose up -d --build --remove-orphans

log "Проверяю доступность из сети edge"
for _ in $(seq 1 20); do
  if docker run --rm --network edge caddy:2 wget -S -O /dev/null http://statichub/ 2>&1 | grep -q "401"; then
    log "Готово: statichub отвечает в сети edge (401 без пароля — админка защищена)."
    docker ps --format '{{.Names}}' | grep -qx edge-caddy \
      || warn "контейнер edge-caddy не запущен: снаружи сайт заработает после его старта (vpnserver-infrastructure)."
    exit 0
  fi
  sleep 2
done
compose logs --tail 20 hub
fail "statichub не отвечает в сети edge. Логи выше."
