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

ARG CACHE_BUST=0.8.5-maxzoom
RUN npm run build

# Prune devDependencies after build (keep production deps + native modules)
RUN npm prune --omit=dev


FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV DATA_DIR=/data
ENV PORT=8787

RUN mkdir -p /data/db /data/charts

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps ./apps

EXPOSE 8787

CMD ["npm", "run", "start"]
