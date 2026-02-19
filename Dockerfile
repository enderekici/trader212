# Stage 1: production dependencies (cached independently of src changes)
FROM node:24-alpine AS deps
WORKDIR /app
ENV npm_config_update_notifier=false
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Stage 2: build (only re-runs when src changes)
FROM node:24-alpine AS builder
WORKDIR /app
ENV npm_config_update_notifier=false
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci
COPY tsconfig.json tsup.config.ts ./
COPY src/ src/
RUN npm run build

# Stage 3: final image (copy from cached stages)
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
RUN mkdir -p data
EXPOSE 3001
CMD ["node", "dist/index.js"]
