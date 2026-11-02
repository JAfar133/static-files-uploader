FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
RUN mkdir -p /sites/static /sites/.staging /sites/meta && chown -R node:node /sites /app
USER node
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
