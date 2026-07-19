# ── Build stage ────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Native-build toolchain for `better-sqlite3` (and any other node-gyp deps).
# Alpine's Node image ships without python3 / make / g++, so npm ci
# fails when node-gyp tries to compile native modules. The toolchain only
# lives in the builder stage — the runtime stage copies prebuilt
# node_modules and stays slim.
RUN apk add --no-cache python3 make g++ libc-dev

# Copy dependency manifests
COPY package*.json ./
COPY apps/mcp/package.json ./apps/mcp/package.json
COPY packages/analytics/package.json ./packages/analytics/package.json
COPY packages/common/package.json ./packages/common/package.json
COPY packages/models/package.json ./packages/models/package.json
COPY packages/plugin/package.json ./packages/plugin/package.json
COPY packages/watcher/package.json ./packages/watcher/package.json

# Install ALL dependencies (needed for build)
RUN npm ci

# Copy full source
COPY . .

# Generate the PostgreSQL client and build both long-running applications.
RUN npx prisma generate
RUN npx nest build api && npx nest build watcher

# ── Runtime stage ──────────────────────────
FROM node:22-alpine AS api-runtime

WORKDIR /app

# Install curl for healthcheck
RUN apk add --no-cache curl

# Copy production deps from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Copy built output
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

# Create logs directory
RUN mkdir -p /app/logs

# ── Environment defaults ──────────────────
# These can be overridden by docker-compose or runtime env
ENV NODE_ENV=production
ENV PORT=3001

# API Security
ENV ENABLE_API_KEY_AUTH=false
ENV API_KEYS=""
ENV API_KEY_HEADER_NAME=x-api-key

# Rate Limiting
ENV RATE_LIMIT_ENABLED=false
ENV RATE_LIMIT_REQUESTS=100
ENV RATE_LIMIT_TIMEFRAME=3600

# Caching
ENV ENABLE_CACHE=true
ENV CACHE_EXPIRY=3600

# Logging
ENV LOG_LEVEL=info

# CORS
ENV CORS_ORIGINS=*

# Search Defaults
ENV DEFAULT_SITE_NAMES=linkedin,indeed,zip_recruiter,glassdoor,google,bayt,naukri,bdjobs,internshala,exa,upwork
ENV DEFAULT_RESULTS_WANTED=20
ENV DEFAULT_DISTANCE=50
ENV DEFAULT_DESCRIPTION_FORMAT=markdown
ENV DEFAULT_COUNTRY=USA

# Swagger
ENV ENABLE_SWAGGER=true
ENV SWAGGER_PATH=api/docs

EXPOSE ${PORT}

# Health check (every 30s, 10s timeout, 5s start, 3 retries)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:${PORT}/health || exit 1

CMD ["node", "dist/apps/api/main.js"]

# ── Watcher runtime stage ──────────────────
FROM api-runtime AS watcher-runtime

ENV WATCHER_ENABLED=true
ENV WATCHER_HEALTH_PORT=3002

EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:${WATCHER_HEALTH_PORT}/health || exit 1

CMD ["node", "dist/apps/watcher/main.js"]

# Keep the default image target backward-compatible with the API.
FROM api-runtime AS final
