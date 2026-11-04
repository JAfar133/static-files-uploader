# Static Hub

Лёгкий загрузчик статических сайтов: React + Node (Express) + Caddy (автоматический HTTPS) в Docker.

## Развёртывание: два режима

Один и тот же проект можно запустить двумя способами. Выбор делает скрипт: он записывает `COMPOSE_FILE` в `.env`,
поэтому дальше работают и обычные команды `docker compose up -d --build`.

| | Самостоятельный | За общим Caddy (edge) |
|---|---|---|
| Скрипт | `scripts/deploy-standalone.sh` | `scripts/deploy-edge.sh` |
| Порты 80/443 | занимает сам | не публикует |
| HTTPS-сертификат | выпускает свой Caddy | выпускает общий Caddy |
| Когда | чистый сервер, один сервис | на сервере уже есть другие сайты |
| Compose-файлы | `docker-compose.yml` + `.standalone.yml` | `docker-compose.yml` + `.edge.yml` |

### Самостоятельно (чистый сервер)
DNS-запись домена должна указывать на сервер, порты 80/443 свободны.
```bash
git clone git@github.com:JAfar133/static-files-uploader.git && cd static-files-uploader
./scripts/deploy-standalone.sh --domain static-hub.example.com
```
Скрипт проверит Docker, свободны ли порты, указывает ли домен на этот сервер, создаст `.env` (спросит логин и пароль
админки или сгенерирует), запустит контейнеры и дождётся HTTPS. Обновление: `./scripts/deploy-standalone.sh --pull`.

### За общим Caddy (сервер vpnserver)
Нужен репозиторий `vpnserver-infrastructure` (общий Caddy и сеть `edge`).
```bash
./scripts/deploy-edge.sh
```
Скрипт проверит наличие сети `edge`, запустит контейнер под алиасом `statichub` без портов и убедится,
что он отвечает внутри сети. Домен `static-hub.smartyalta.ru` описан в `vpnserver-infrastructure/caddy/sites/static-hub.caddy`.

Пароль админки меняется так: удалите строки `ADMIN_USER`/`ADMIN_PASS_HASH` из `.env` и запустите скрипт заново
(или вручную: `docker run --rm -it caddy:2 caddy hash-password`, значение в одинарных кавычках в `ADMIN_PASS_HASH`).

## Использование

1. Откройте `https://static-hub.smartyalta.ru`, введите логин/пароль.
2. Перетащите в рамку HTML-файл, `.zip` или папку (или нажмите «Файлы / ZIP» / «Папка»).
3. Задайте имя проекта и нажмите «Опубликовать».
4. Проект доступен по `https://static-hub.smartyalta.ru/public/static/<имя>/` и `http://<ip>/public/static/<имя>/`
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
