# The KNTY CEO server. The desktop app is installed separately on Windows PCs.
FROM node:22-alpine AS build
WORKDIR /src
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY . .
RUN npm ci --workspace @ceo/shared --workspace @ceo/server --include-workspace-root \
 && npm run build -w @ceo/shared && npm run build -w @ceo/server \
 && npm prune --omit=dev --workspace @ceo/shared --workspace @ceo/server --include-workspace-root

FROM node:22-alpine
ENV NODE_ENV=production PORT=8090
WORKDIR /app
COPY --from=build /src/package.json ./
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/packages/shared/package.json packages/shared/
COPY --from=build /src/packages/shared/dist packages/shared/dist
COPY --from=build /src/apps/server/package.json apps/server/
COPY --from=build /src/apps/server/dist apps/server/dist
COPY --from=build /src/apps/server/migrations apps/server/migrations
COPY --from=build /src/LICENSE /src/THIRD_PARTY_NOTICES.md ./
USER node
WORKDIR /app/apps/server
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:8090/health || exit 1
CMD ["node", "dist/index.js"]
