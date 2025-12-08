# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS base
ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN apk add --no-cache libc6-compat python3 make g++ \
  && corepack enable
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages ./packages
RUN pnpm install --filter @scspace-server... --frozen-lockfile

FROM base AS builder
WORKDIR /workspace/packages/server
RUN pnpm run build

FROM node:20-alpine AS prod-deps
ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN apk add --no-cache libc6-compat \
  && corepack enable
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages ./packages
RUN pnpm install --filter @scspace-server... --prod --frozen-lockfile

FROM node:20-alpine AS runner
ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH="$PNPM_HOME:$PATH"
ENV NODE_ENV=production
RUN apk add --no-cache libc6-compat \
  && corepack enable
WORKDIR /workspace
COPY --from=prod-deps /workspace/node_modules ./node_modules
COPY --from=prod-deps /workspace/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=prod-deps /workspace/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=prod-deps /workspace/package.json ./package.json
COPY --from=prod-deps /workspace/tsconfig.json ./tsconfig.json
COPY --from=base /workspace/packages ./packages
COPY --from=builder /workspace/packages/server/dist ./packages/server/dist
WORKDIR /workspace/packages/server
EXPOSE 3001
CMD ["pnpm", "run", "start:prod"]

FROM base AS dev
WORKDIR /workspace/packages/server
EXPOSE 3001
CMD ["pnpm", "run", "start:dev"]
