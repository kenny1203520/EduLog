# Base images are pinned by tag and digest; bump both together.
# Build and dependency stages use the -dev variants (shell and npm); the
# runtime stage is the minimal non-dev image with no shell or package manager.
FROM dhi.io/node:26-alpine-dev@sha256:16375cc385b69dbd63d19603d5ba671493294b4cd4d0e3d8132abb0562e29db5 AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM dhi.io/node:26-alpine-sfw-dev@sha256:8d4966a4a4dde05cdf98bcf1c40e8d83938766a6a42bb34aa6ce174097179937 AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM dhi.io/node:26-alpine@sha256:f7b40a7a5e3b75dafd68687f9f5cd4989a2ca02a5004e03147596e7bf8653acc AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=legal /LICENSE /NOTICE /usr/share/licenses/EduLog/
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --retries=5 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"]
CMD ["node", "dist/index.js"]
