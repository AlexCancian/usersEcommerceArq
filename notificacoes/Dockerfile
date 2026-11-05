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

# Sem banco, sem seed, sem migration: só as dependências de execução.
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production

# Sem EXPOSE: o serviço não tem HTTP. Forma exec: o Node é o PID 1 e recebe o SIGTERM.
CMD ["node", "dist/index.js"]
