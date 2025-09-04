# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
WORKDIR /app

# Install only what we need for healthcheck
RUN apk add --no-cache curl

# Copy manifests first for cached install
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy the rest of the app
COPY . .
# Ensure runtime user can write logs/results
RUN chown -R node:node /app

# Environment
ENV NODE_ENV=production \
    PORT=8080

# Expose port
EXPOSE 8080

# Simple healthcheck hitting the API (adjust if needed)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:${PORT}/api/leaderboard || curl -fsS http://localhost:${PORT}/leaderboard || exit 1

# Run as the node user for safety
USER node

# Default command
CMD ["npm", "start"]

# Optional test stage
FROM node:20-alpine AS test
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NODE_ENV=test
CMD ["npm", "test"]
