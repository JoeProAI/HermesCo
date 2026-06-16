# syntax=docker/dockerfile:1.6
# Launchpad OpenClaw — one-click OpenClaw gateway on Daytona
FROM node:20-slim AS base

ENV DEBIAN_FRONTEND=noninteractive \
    OPENCLAW_HOME=/workspace/.openclaw \
    HOME=/workspace

RUN apt-get update && apt-get install -y --no-install-recommends \
      git curl ca-certificates tini python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Cloudflare Tunnel daemon
ARG TARGETARCH=amd64
RUN curl -fsSL -o /tmp/cloudflared.deb \
      "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${TARGETARCH}.deb" \
 && dpkg -i /tmp/cloudflared.deb \
 && rm /tmp/cloudflared.deb

WORKDIR /workspace

# Install OpenClaw CLI globally
ARG OPENCLAW_VERSION=latest
RUN npm install -g "openclaw@${OPENCLAW_VERSION}"

COPY openclaw.template.json /opt/launchpad/openclaw.template.json
COPY start.sh /opt/launchpad/start.sh
RUN chmod +x /opt/launchpad/start.sh

EXPOSE 42069
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:42069/healthz || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/opt/launchpad/start.sh"]
