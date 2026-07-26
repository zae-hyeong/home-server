# 1. Dependency Stage
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# npm install을 위해 package 파일 복사
COPY package.json package-lock.json* ./
RUN npm ci

# 2. Build Stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js Telemetry 비활성화
ENV NEXT_TELEMETRY_DISABLED=1

# 빌드 수행
RUN npm run build

# 3. Runner Stage
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# 권한 및 보안을 위한 비루트 사용자 추가
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# 빌드 결과물 및 런타임 의존성 복사
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/routes.json ./routes.json

# 파일 소유권 조정
RUN chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

# Next.js 기본 실행 방식이 아닌 커스텀 Express 서버(server.js) 구동
CMD ["node", "server.js"]
