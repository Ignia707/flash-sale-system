# One image for the API and the worker: only the start command differs.
FROM docker.io/library/node:24-alpine

WORKDIR /app
RUN npm install -g pnpm@10.25.0

# dependencies first, so this layer is cached until package files change
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

# Node 24 runs .ts files directly, so there is no build step
COPY src ./src

ENV NODE_ENV=production
USER node
CMD ["node", "src/api/server.ts"]
