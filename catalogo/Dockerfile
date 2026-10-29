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

# Dependências completas: o seed roda com tsx dentro do container,
# porque o Mongo não publica porta e não é alcançado de fora da rede do compose.
RUN npm ci

COPY --from=builder /app/dist ./dist
COPY tsconfig.json ./
COPY src ./src/
COPY seeds ./seeds/

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Seed idempotente (3 categorias e 10 produtos) antes de subir a API.
CMD ["sh", "-c", "npm run seed && node dist/index.js"]
