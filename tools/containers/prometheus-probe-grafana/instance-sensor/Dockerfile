# overleaf-instance-sensor — self-contained prometheus gauge exporter for
# the PR yu-i-i/overleaf-cep#178 instance-statistics sensors.
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY sensor.mjs ./
RUN chown -R node:node /app

EXPOSE 9464
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD wget -q --spider --timeout=3 http://127.0.0.1:9464/healthz || exit 1

ENTRYPOINT ["node", "sensor.mjs"]
