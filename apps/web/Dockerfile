# Build context is the repo root: the web app imports @imagine/sdk from the workspace.
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
RUN pnpm install --frozen-lockfile --filter @imagine/web...

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/sdk/node_modules ./packages/sdk/node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY package.json pnpm-workspace.yaml ./
COPY packages/sdk ./packages/sdk
COPY apps/web ./apps/web

# These are inlined into the client bundle at build time, so they must be
# present here rather than only at runtime.
ARG NEXT_PUBLIC_API_URL=https://api.imagine.fun
ARG NEXT_PUBLIC_RPC_URL=https://api.imagine.fun/rpc
ARG NEXT_PUBLIC_WS_URL=wss://api.imagine.fun/rpc-ws
ARG NEXT_PUBLIC_CLUSTER=mainnet-beta
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID
ARG NEXT_PUBLIC_OFFICIAL_MINT
ARG NEXT_PUBLIC_X_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_RPC_URL=$NEXT_PUBLIC_RPC_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_CLUSTER=$NEXT_PUBLIC_CLUSTER
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID
ENV NEXT_PUBLIC_OFFICIAL_MINT=$NEXT_PUBLIC_OFFICIAL_MINT
ENV NEXT_PUBLIC_X_URL=$NEXT_PUBLIC_X_URL
ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app/apps/web
RUN pnpm build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app ./
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["sh", "-c", "pnpm exec next start -p ${PORT:-3000}"]
