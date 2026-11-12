# Estágio de Build
FROM node:22-slim AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY tsconfig.json ./
COPY src ./src/

RUN npm run build

# Estágio de Produção
FROM node:22-slim AS runner

WORKDIR /app

COPY package*.json ./

# Sem banco, sem migration: simulação em memória.
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Forma exec: o Node é o PID 1 e recebe o SIGTERM.
CMD ["node", "dist/index.js"]
