FROM node:22-alpine

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .env.example ./
COPY packages ./packages
COPY apps/worker ./apps/worker

RUN pnpm install --frozen-lockfile --filter @poker/worker... --filter @poker/config...
RUN pnpm --filter @poker/worker build

CMD ["pnpm", "--filter", "@poker/worker", "start"]
