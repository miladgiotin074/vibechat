# API and worker share this image; docker-compose picks the command.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY migrations ./migrations
# photos (STORAGE_DRIVER=local): a Docker volume mounted here starts out owned by node
RUN mkdir -p /data/media && chown node:node /data/media
USER node
EXPOSE 4000
CMD ["node", "dist/src/server.js"]
