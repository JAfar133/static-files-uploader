FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json ./
RUN npm install
COPY web/ ./
RUN npm run build

FROM caddy:2
COPY caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=web /web/dist /srv/app
