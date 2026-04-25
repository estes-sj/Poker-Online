FROM node:22-bookworm-slim

WORKDIR /app
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .env.example ./
COPY packages ./packages
COPY apps/api ./apps/api

RUN pnpm install --frozen-lockfile --filter @poker/api... --filter @poker/db... --filter @poker/config...
RUN pnpm --filter @poker/db generate
RUN pnpm --filter @poker/api build

CMD ["pnpm", "--filter", "@poker/api", "start"]
