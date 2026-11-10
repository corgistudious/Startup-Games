# One image for the API server and the world worker (different CMD).
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/server ./apps/server
COPY apps/worker ./apps/worker
RUN pnpm install --frozen-lockfile --filter @startup/server... --filter @startup/worker...
RUN pnpm --filter @startup/server build && pnpm --filter @startup/worker build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && addgroup -S app && adduser -S app -G app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/worker/package.json apps/worker/package.json
RUN pnpm install --frozen-lockfile --prod --filter @startup/server --filter @startup/worker
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/worker/dist apps/worker/dist
COPY infra/migrations infra/migrations
ENV MIGRATIONS_DIR=/app/infra/migrations
USER app
EXPOSE 8080
CMD ["node", "apps/server/dist/main.js"]
