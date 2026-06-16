# syntax=docker/dockerfile:1.6
# Launchpad Hermes — one-click Nous Hermes agent on Daytona
FROM python:3.12-slim AS base

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    HERMES_HOME=/workspace/.hermes \
    HOME=/workspace

RUN apt-get update && apt-get install -y --no-install-recommends \
      git curl ca-certificates build-essential tini \
    && rm -rf /var/lib/apt/lists/*

# Cloudflare Tunnel daemon — connects sandbox to the user's clawd.run subdomain
ARG TARGETARCH=amd64
RUN curl -fsSL -o /tmp/cloudflared.deb \
      "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${TARGETARCH}.deb" \
 && dpkg -i /tmp/cloudflared.deb \
 && rm /tmp/cloudflared.deb

WORKDIR /workspace

# Hermes install (uses the published wheel; pin a known-good version)
ARG HERMES_VERSION=0.14.0
RUN python -m venv /opt/hermes-venv \
 && /opt/hermes-venv/bin/pip install --no-cache-dir --upgrade pip \
 && /opt/hermes-venv/bin/pip install --no-cache-dir "hermes-agent[web]==${HERMES_VERSION}" \
 && /opt/hermes-venv/bin/pip install --no-cache-dir daytona

ENV PATH="/opt/hermes-venv/bin:${PATH}"

COPY start.sh /opt/launchpad/start.sh
RUN chmod +x /opt/launchpad/start.sh

EXPOSE 4242
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4242/healthz || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/opt/launchpad/start.sh"]
