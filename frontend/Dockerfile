# Builds the shop page, then serves it with NGINX (the same NGINX that fronts the API).
FROM docker.io/library/node:24-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@10.25.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM docker.io/library/nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
