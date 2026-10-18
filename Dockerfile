# Europa — Production Multi-Stage Dockerfile
# Optimized for Node.js 22 LTS, unprivileged non-root execution, and small image size.

# Stage 1: Dependency Installation
FROM node:22-alpine AS dependencies
WORKDIR /app

# Install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# Stage 2: Production Runtime
FROM node:22-alpine AS runner
WORKDIR /app

# Install dumb-init for POSIX signal propagation and curl for container health checks
RUN apk add --no-cache dumb-init curl

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Copy production node_modules from dependencies stage
COPY --from=dependencies /app/node_modules ./node_modules

# Copy application source, public web assets, migration scripts, and seed fixtures
COPY package.json ./
COPY src/ ./src/
COPY public/ ./public/
COPY scripts/ ./scripts/
COPY test/fixtures/ ./test/fixtures/

# Create persistent storage directory for snapshot archives and assign ownership to node user
RUN mkdir -p /app/storage/snapshots && chown -R node:node /app

# Switch to unprivileged non-root user (UID 1000)
USER node

# Expose internal application HTTP port
EXPOSE 3000

# Container liveness health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/v1/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/index.js"]
