FROM node:22-alpine

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .env.example ./
COPY infra/docker/pnpm ./infra/docker/pnpm
COPY packages ./packages
COPY apps/web ./apps/web

RUN node ./infra/docker/pnpm/9.12.3/bin/pnpm.cjs install --frozen-lockfile --filter @poker/web... --filter @poker/ui... --filter @poker/config...
RUN node ./infra/docker/pnpm/9.12.3/bin/pnpm.cjs --filter @poker/ui build
RUN node ./infra/docker/pnpm/9.12.3/bin/pnpm.cjs --filter @poker/web build

CMD ["node", "./infra/docker/pnpm/9.12.3/bin/pnpm.cjs", "--filter", "@poker/web", "start"]
