# syntax=docker/dockerfile:1

ARG NODE_VERSION=24.9.0
FROM node:${NODE_VERSION}-slim AS base
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

FROM base AS runner
ENV HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
