# syntax=docker/dockerfile:1
# check=skip=FromPlatformFlagConstDisallowed

# Stage 1: build on amd64 natively (tsup output is pure JS — no QEMU needed)
FROM --platform=linux/amd64 node:24-alpine AS builder
WORKDIR /app
ENV npm_config_update_notifier=false
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci
COPY tsconfig.json tsup.config.ts ./
COPY src/ src/
RUN npm run build

# Stage 2: production deps on the TARGET platform (better-sqlite3 needs native build)
FROM node:24-alpine AS deps
WORKDIR /app
ENV npm_config_update_notifier=false
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Stage 3: minimal runtime image
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
# Copy pure-JS bundle from amd64 builder + native node_modules from target-platform deps
COPY --from=builder /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
RUN mkdir -p data \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:3001/api/status').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
