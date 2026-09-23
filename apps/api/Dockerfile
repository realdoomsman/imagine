# Build context is the repo root: the API imports @vise/sdk from the workspace.
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Every workspace manifest the lockfile knows about must be present, or
# --frozen-lockfile refuses the install even for an unrelated filter.
COPY packages/sdk/package.json packages/sdk/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY video/package.json video/
RUN pnpm install --frozen-lockfile --filter @vise/api...

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/sdk/node_modules ./packages/sdk/node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY package.json pnpm-workspace.yaml ./
COPY packages/sdk ./packages/sdk
COPY apps/api ./apps/api

WORKDIR /app/apps/api
EXPOSE 8080

# Node 24 strips the type annotations at load time, so the TypeScript sources
# run directly — no build step and no emitted JavaScript to keep in sync.
#
# One image, two roles. ROLE=api serves HTTP and can scale out; ROLE=indexer
# builds the read model and runs the keeper, and must stay a singleton — two
# keepers would race to send the same distributions.
CMD ["sh", "-c", "node src/migrate.ts && node src/${ROLE:-index}.ts"]
