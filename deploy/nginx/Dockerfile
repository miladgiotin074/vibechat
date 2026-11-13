# Builds the Mini App (static files) and bakes them into nginx.
FROM node:22-bookworm-slim AS miniapp
WORKDIR /app
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL VITE_DEV_MOCK=false
COPY apps/miniapp/package.json apps/miniapp/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY apps/miniapp/ ./
RUN npx vite build

FROM nginx:1.27-alpine
COPY deploy/nginx/nginx.conf /etc/nginx/nginx.conf
COPY deploy/nginx/cloudflare.conf /etc/nginx/cloudflare.conf
COPY deploy/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=miniapp /app/dist /usr/share/nginx/miniapp
