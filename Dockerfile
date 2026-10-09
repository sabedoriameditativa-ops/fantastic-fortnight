# Frota Estelar — container image (any Docker host: Fly.io, Railway, VPS...)
FROM node:22-alpine
ENV NODE_ENV=production PORT=3000 TRUST_PROXY=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server ./server
COPY shared ./shared
COPY client ./client
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "server/index.js"]
