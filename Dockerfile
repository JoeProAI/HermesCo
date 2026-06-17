# HermesCo — production container for Fly.io
FROM node:22-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# Install dependencies (use lockfile for reproducibility)
COPY package.json package-lock.json .npmrc ./
RUN npm ci

# Build
COPY . .
# Public Convex deployment URL. Inlined at build so the client ConvexProvider
# wires up; also set at runtime (fly.toml [env]) for the server-side store.
ARG NEXT_PUBLIC_CONVEX_URL
ENV NEXT_PUBLIC_CONVEX_URL=$NEXT_PUBLIC_CONVEX_URL
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "run", "start", "--", "-p", "3000", "-H", "0.0.0.0"]
