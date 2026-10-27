# Build context: web/  (docker build -t ticketing-web web)
FROM node:24.22.1-alpine AS build
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx ng build --configuration production

FROM nginxinc/nginx-unprivileged:1.30-alpine
ENV API_UPSTREAM=api:8080 \
    NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY nginx/proxy-headers.conf /etc/nginx/snippets/proxy-headers.conf
COPY --from=build /web/dist/ticketing-web/browser /usr/share/nginx/html
EXPOSE 8080
