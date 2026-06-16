FROM oven/bun:1 AS builder

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json bun.lock ./
COPY packages/api/package.json packages/api/package.json
COPY packages/web/package.json packages/web/package.json
RUN bun install --frozen-lockfile

COPY packages/api packages/api
RUN bun run --cwd packages/api build

FROM oven/bun:1 AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app ./

EXPOSE 3000

CMD ["bun", "run", "--cwd", "packages/api", "start"]
