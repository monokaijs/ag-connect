FROM node:20-alpine AS frontend

WORKDIR /build/web
COPY web/package.json web/package-lock.json* ./
RUN npm ci --legacy-peer-deps
COPY web/ ./
RUN npm run build

FROM node:20-alpine AS backend

WORKDIR /build
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM node:20-alpine

RUN apk add --no-cache nginx openssh-keygen

WORKDIR /app

COPY --from=backend /build/node_modules ./node_modules
COPY package.json ./
COPY src/ ./src/
COPY public/ ./public/
COPY --from=frontend /build/web/dist ./web/dist

COPY deploy/nginx.conf /etc/nginx/http.d/default.conf

COPY deploy/start.sh /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE 80

CMD ["/app/start.sh"]
