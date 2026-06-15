FROM node:lts-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime
WORKDIR /usr/share/nginx/html

COPY --from=build /app/dist ./
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY nginx/docker-entrypoint.d/05-edulog-runtime.envsh /docker-entrypoint.d/05-edulog-runtime.envsh

RUN chmod +x /docker-entrypoint.d/05-edulog-runtime.envsh

EXPOSE 4173 4174
