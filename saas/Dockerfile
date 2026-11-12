# PaidOnTime on a tiny server. SQLite lives on the /data volume.
FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY core ./core
COPY products ./products
ENV NODE_ENV=production DATA_DIR=/data PORT=8080
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "--no-warnings", "products/latepay/server.js"]
