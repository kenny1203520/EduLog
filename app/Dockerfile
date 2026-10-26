FROM dhi.io/node:26-alpine-dev AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM dhi.io/nginx:1-alpine AS runtime
WORKDIR /usr/share/nginx/html

COPY --chown=65532:65532 --from=build /app/dist ./
COPY --chmod=755 nginx/docker-entrypoint.d/05-edulog-runtime.envsh /docker-entrypoint.d/05-edulog-runtime.envsh

EXPOSE 4173 4174

ENTRYPOINT ["/docker-entrypoint.d/05-edulog-runtime.envsh"]
CMD ["nginx", "-g", "daemon off;"]
