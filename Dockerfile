FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json ./
RUN pnpm install --no-frozen-lockfile
COPY . .
RUN pnpm check && pnpm build && pnpm prune --prod

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S gateaway && adduser -S gateaway -G gateaway
COPY --from=build --chown=gateaway:gateaway /app/dist ./dist
COPY --from=build --chown=gateaway:gateaway /app/node_modules ./node_modules
COPY --from=build --chown=gateaway:gateaway /app/package.json ./package.json
USER gateaway
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
