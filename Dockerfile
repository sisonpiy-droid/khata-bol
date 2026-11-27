FROM node:24-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
# KHATA_DB is the default for `docker compose up` (volume mounted at /data).
# On Railway, RAILWAY_VOLUME_MOUNT_PATH takes over automatically. Railway forbids the VOLUME keyword, so none is declared.
ENV NODE_ENV=production PORT=8787 KHATA_DB=/data/khata.db
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY --from=build /app/dist ./dist
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
