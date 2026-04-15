FROM node:22-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

FROM base AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/zerodev/package.json packages/zerodev/package.json
COPY apps/backend apps/backend
COPY packages/shared packages/shared
COPY packages/zerodev packages/zerodev

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @guardlabs/guardrail-core build
RUN pnpm --filter @guardlabs/guardrail-kernel build
RUN pnpm --filter @guardlabs/guardrail-backend build
RUN pnpm --filter @guardlabs/guardrail-backend deploy --legacy --prod /prod/backend

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build /prod/backend/package.json ./package.json
COPY --from=build /prod/backend/node_modules ./node_modules
COPY --from=build /prod/backend/dist ./dist
COPY --from=build /prod/backend/drizzle ./drizzle

EXPOSE 3000

CMD ["sh", "-c", "node dist/db/migrate.js && node dist/server.js"]
