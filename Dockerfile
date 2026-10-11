# syntax=docker/dockerfile:1

ARG NODE_VERSION=24.9.0
ARG BUN_VERSION=1.4.2
FROM oven/bun:${BUN_VERSION}-slim AS bun
FROM node:${NODE_VERSION}-slim AS base
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1

FROM base AS build
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential node-gyp pkg-config python-is-python3 && \
    rm -rf /var/lib/apt/lists/*
RUN npm install -g yarn@1.22.22 --force
COPY .yarnrc.yml package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production=false
COPY . .
RUN --network=none yarn build
RUN bun --no-env-file build scripts/fly-recovery.ts --target=bun --env=disable --outfile /fly-recovery.js

FROM base AS runner
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /fly-recovery.js ./scripts/fly-recovery.js
USER node
EXPOSE 3000
CMD ["bun", "--no-env-file", "scripts/fly-recovery.js"]
