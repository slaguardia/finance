# finance image. Compiles the TS backend; bakes the PREBUILT PWA (web/dist, built
# by scripts/build-web.sh against @brainbot/web-toolkit). Build context = repo root.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
 && npm ci --no-audit --no-fund \
 && apt-get purge -y python3 make g++ && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY backend/migrations ./migrations
COPY web/dist ./web/dist
ENV DATA_DIR=/data BACKUP_DIR=/backups PORT=8789
RUN mkdir -p /data /backups
EXPOSE 8789
CMD ["node", "dist/index.js"]
