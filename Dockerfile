# AskCharts on a server: the app, the sign-in gateway and the collectors in one container, kept running
# by run.mjs. Your data lives in the /data volume. See docs/SERVER.md.
FROM node:24.21.0-bookworm-slim

# unzip and curl for Kraken's history archives (the slim image has neither)
RUN apt-get update \
 && apt-get install -y --no-install-recommends unzip curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/askcharts
COPY . .
# the gateway's two packages (passkeys); the rest is plain Node
RUN cd gateway && npm ci --omit=dev --no-audit --no-fund \
 && mkdir -p /data && chown node:node /data

USER node
ENV ASKCHARTS_DATA=/data \
    ASKCHARTS_GATEWAY=1 \
    NODE_ENV=production
VOLUME /data
EXPOSE 3778

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:'+require('fs').readFileSync('/data/port','utf8')+'/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "run.mjs"]
