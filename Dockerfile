# HermesCo — production container for Fly.io
FROM node:22-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# Install dependencies (use lockfile for reproducibility)
COPY package.json package-lock.json .npmrc ./
RUN npm ci

# Build
COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "run", "start", "--", "-p", "3000", "-H", "0.0.0.0"]
