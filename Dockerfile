# Pons Family: container image for Jay, the pons.family support agent.
# Two stages: build TypeScript (and the better-sqlite3 native module) with the
# full toolchain, then ship only production deps and compiled JS.

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production DATABASE_PATH=/data/jay.db
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY knowledge ./knowledge
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
CMD ["node", "dist/index.js", "run"]
