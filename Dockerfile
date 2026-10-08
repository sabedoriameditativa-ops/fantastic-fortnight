FROM node:24.19.0-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
# Optional build-only CA for networks with an explicit corporate trust root.
# It is mounted as a BuildKit secret and never copied into an image layer.
RUN --mount=type=secret,id=npm_ca \
    if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:24.19.0-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 FE_DATA_DIR=/data
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json LICENSE.txt THIRD_PARTY_NOTICES.md ./
COPY client ./client
COPY shared ./shared
COPY server ./server
# Source permissions from an exported checkout can be 0600/0700. Runtime
# code stays root-owned and readable; only the data directory is writable.
RUN chmod -R a+rX /app && mkdir /data && chown node:node /data && chmod 700 /data
USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(async r=>{if(!r.ok||!(await r.json()).ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
