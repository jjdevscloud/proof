# Sequents: one service serving the website, the indexer API (/api) and a restricted RPC proxy (/rpc).

# --- build the website ---
FROM node:24-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web ./
# The browser-side verifier imports the indexer's derivation module; the demo preview reads the rules.
COPY indexer/src/derive.ts /app/indexer/src/derive.ts
COPY rules /app/rules
ARG VITE_CLUSTER=mainnet-beta
ENV VITE_RPC_URL=/rpc VITE_API_URL=/api VITE_CLUSTER=${VITE_CLUSTER}
RUN npm run build
# Every page with demo data, served at /preview (for design work before and after launch).
RUN npm run build:demo

# --- runtime: the indexer has no runtime dependencies (Node runs its TypeScript directly) ---
FROM node:24-slim
WORKDIR /app
COPY indexer/src ./indexer/src
COPY indexer/config.*.json ./indexer/
COPY rules ./rules
COPY --from=web /app/web/dist ./web/dist
COPY --from=web /app/web/dist-preview ./web/dist-preview
ENV NODE_ENV=production STATIC_DIR=/app/web/dist STATIC_PREVIEW_DIR=/app/web/dist-preview DATA_DIR=/data
# Railway sets PORT; RPC_URL comes from a service variable (secret).
ARG INDEXER_CONFIG=indexer/config.mainnet.json
ENV INDEXER_CONFIG=${INDEXER_CONFIG}
CMD ["sh", "-c", "exec node indexer/src/main.ts \"$INDEXER_CONFIG\""]
