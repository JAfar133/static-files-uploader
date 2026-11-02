# Static Hub

Лёгкий загрузчик статических сайтов: React + Node (Express) + Caddy (автоматический HTTPS) в Docker.

## Развёртывание

Порты 80/443 на сервере занимает Caddy проекта expenses-tracker, поэтому Static Hub не публикует портов:
он подключается к docker-сети `expenses-tracker_default` (алиас `statichub`), а TLS даёт существующий Caddy.

```bash
./setup.sh                          # создаст .env (логин и хэш пароля)
docker compose up -d --build        # поднимает hub-api и hub
```

Затем в `/home/mikhail/projects/expenses/infra/Caddyfile.public` добавьте блоки из
`caddy/expenses-caddy-snippet.txt` и перезагрузите конфиг без простоя
(правьте файл «на месте», например `cat >>`, а не `sed -i`: bind-mount привязан к inode):

```bash
docker exec expenses-tracker-web-1 caddy reload --config /etc/caddy/Caddyfile
```

DNS `vpnserver.smartyalta.ru` уже указывает на `85.209.51.95`.

## Использование

1. Откройте `https://vpnserver.smartyalta.ru`, введите логин/пароль.
2. Перетащите в рамку HTML-файл, `.zip` или папку (или нажмите «Файлы / ZIP» / «Папка»).
3. Задайте имя проекта и нажмите «Опубликовать».
4. Проект доступен по `https://vpnserver.smartyalta.ru/public/static/<имя>/` и `http://<ip>/public/static/<имя>/`
   (по IP через HTTPS — самоподписанный сертификат).

Правила:
- Одиночный HTML-файл становится `index.html`.
- Если архив/папка содержит одну вложенную папку, она используется как корень.
- Существующий проект перезаписывается только с галочкой «Перезаписать».
- Удаление и список — в карточках проектов.
- Лимит загрузки: `MAX_UPLOAD_MB` в `.env` (по умолчанию 500).

Админка и API закрыты паролем, `/public/static/*` открыт всем.
Загруженный JS исполняется на том же домене, что и админка — загружайте только доверенный код.

## Разработка

```bash
cd api && npm i && STATIC_DIR=./data/static STAGING_DIR=./data/.staging node server.js
cd web && npm i && npm run dev
```
