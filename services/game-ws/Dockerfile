# Build
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Run
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
RUN addgroup -g 1001 -S app && adduser -S app -u 1001 -G app && chown -R app:app /app
USER app
EXPOSE 8080
CMD ["node", "dist/server.js"]
