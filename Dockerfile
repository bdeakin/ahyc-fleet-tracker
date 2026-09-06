# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/

RUN npm ci

COPY packages/shared ./packages/shared
COPY apps/server ./apps/server
COPY apps/web ./apps/web

ARG CACHE_BUST=0.8.8-memory
RUN npm run build

# Cut the historical chart pyramids here, where there is memory and CPU to spare. The
# runtime container then only ever reads tiles off disk.
RUN DATA_DIR=/app/tile-build node apps/server/dist/tools/cutTiles.js \
    && mv /app/tile-build/historical-tiles /app/tile-seed \
    && rm -rf /app/tile-build

# Prune devDependencies after build (keep production deps + native modules)
RUN npm prune --omit=dev


FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV DATA_DIR=/data
ENV PORT=8787
# Left uncapped, V8 sizes its heap from the host's memory rather than the container's limit,
# so a spike gets the process killed instead of collected. Raise this on a larger instance.
ENV NODE_OPTIONS="--max-old-space-size=384"
ENV HISTORICAL_TILE_SEED_DIR=/app/tile-seed

RUN mkdir -p /data/db /data/charts

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps ./apps
COPY --from=build /app/tile-seed ./tile-seed

EXPOSE 8787

# node directly, not `npm run start`: npm does not forward SIGTERM to the server and exits
# non-zero when the platform stops the container, which reads as a crash and triggers a
# restart loop.
CMD ["node", "apps/server/dist/index.js"]
