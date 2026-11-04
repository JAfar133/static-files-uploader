# Общие функции скриптов развёртывания. Подключается через `source`.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log()  { printf '\033[1;34m[static-hub]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[static-hub] Внимание:\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m[static-hub] Ошибка:\033[0m %s\n' "$*" >&2; exit 1; }

require_docker() {
  command -v docker >/dev/null 2>&1 || fail "не найден docker. Установите Docker Engine с плагином compose."
  docker compose version >/dev/null 2>&1 || fail "не найден 'docker compose' (плагин compose v2)."
  docker info >/dev/null 2>&1 || fail "Docker не запущен или нет прав (добавьте пользователя в группу docker)."
}

env_file() { printf '%s/.env' "$ROOT_DIR"; }

get_env_value() { sed -n "s/^$1=//p" "$(env_file)" 2>/dev/null | tail -n1; }

# Записывает KEY=VALUE в .env (заменяет строку или добавляет). Значения с $ передавайте в одинарных кавычках: "'...'".
set_env_value() {
  local key="$1" value="$2" f tmp
  f="$(env_file)"; touch "$f"; chmod 600 "$f"
  tmp="$(mktemp)"
  grep -v "^${key}=" "$f" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  cat "$tmp" > "$f"; rm -f "$tmp"
}

# Логин и пароль админки: берём из .env, иначе из переменных/ввода, иначе генерируем случайный пароль
ensure_admin_credentials() {
  local user="${ADMIN_USER_ARG:-}" pass="${ADMIN_PASSWORD:-}" hash generated=0
  if [ -n "$(get_env_value ADMIN_PASS_HASH)" ] && [ -z "$user$pass" ]; then
    log "Логин и пароль админки уже заданы в .env (оставляю как есть)"
    return 0
  fi
  [ -n "$user" ] || user="$(get_env_value ADMIN_USER)"
  if [ -z "$user" ]; then
    if [ -t 0 ]; then read -rp "Логин админки [admin]: " user; fi
    user="${user:-admin}"
  fi
  if [ -z "$pass" ]; then
    if [ -t 0 ]; then
      read -rsp "Пароль админки (Enter — сгенерировать): " pass; echo
    fi
    if [ -z "$pass" ]; then pass="$(openssl rand -base64 24 | tr -d '=+/\n' | cut -c1-20)"; generated=1; fi
  fi
  hash="$(docker run --rm caddy:2 caddy hash-password --plaintext "$pass")" || fail "не удалось получить хэш пароля."
  set_env_value ADMIN_USER "$user"
  set_env_value ADMIN_PASS_HASH "'$hash'"
  log "Админка: логин $user"
  [ "$generated" = 1 ] && log "Сгенерированный пароль (покажу один раз, сохраните): $pass"
  return 0
}

port_in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

# Порты 80/443 должны быть свободны или принадлежать нашему же контейнеру hub
ensure_ports_free() {
  local port owner ours
  ours="$(cd "$ROOT_DIR" && docker compose ps --format '{{.Name}}' hub 2>/dev/null | head -1 || true)"
  for port in 80 443; do
    port_in_use "$port" || continue
    owner="$(docker ps --filter "publish=$port" --format '{{.Names}}' | head -1)"
    [ -n "$owner" ] && [ "$owner" = "$ours" ] && continue
    fail "порт $port уже занят${owner:+ контейнером $owner}. Для сервера, где 80/443 уже заняты другим Caddy, используйте scripts/deploy-edge.sh."
  done
}

# Домен должен указывать на этот сервер, иначе Let's Encrypt не выдаст сертификат
check_dns() {
  local domain="$1" mine theirs
  mine="$(curl -4 -fsS --max-time 5 https://ifconfig.me 2>/dev/null || true)"
  theirs="$( (dig +short A "$domain" 2>/dev/null || getent hosts "$domain" 2>/dev/null | awk '{print $1}') | tail -1)"
  if [ -z "$theirs" ]; then
    fail "у $domain нет A-записи. Создайте её (→ ${mine:-IP сервера}) или запустите с --skip-dns-check."
  fi
  if [ -n "$mine" ] && [ "$mine" != "$theirs" ]; then
    fail "$domain указывает на $theirs, а этот сервер — $mine. Исправьте DNS или запустите с --skip-dns-check."
  fi
  log "DNS в порядке: $domain → $theirs"
}

compose() { (cd "$ROOT_DIR" && docker compose "$@"); }

pull_code() {
  [ -d "$ROOT_DIR/.git" ] || return 0
  if [ -n "$(git -C "$ROOT_DIR" status --porcelain --untracked-files=no)" ]; then
    fail "в папке проекта есть локальные изменения, git pull их затронет: git status"
  fi
  log "Обновляю код (git pull)"
  git -C "$ROOT_DIR" pull --ff-only || fail "git pull не выполнен."
}
