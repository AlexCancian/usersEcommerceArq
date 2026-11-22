import dotenv from "dotenv";
dotenv.config();

const ttlCache = parseInt(process.env.CACHE_TTL_SEGUNDOS ?? "", 10);

export const env = {
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  NODE_ENV: process.env.NODE_ENV || "development",
  MONGO_URI:
    process.env.MONGO_URI || "mongodb://localhost:27017/ecommerce_catalogo",
  // Kafka (aula 08): lista separada por vírgula
  KAFKA_BROKERS: (process.env.KAFKA_BROKERS || "kafka:9092")
    .split(",")
    .map((b) => b.trim())
    .filter(Boolean),
  // Cache (aula 10): Redis na rede do compose; TTL base em segundos (inválido ou < 1 → 60)
  REDIS_URL: process.env.REDIS_URL || "redis://redis:6379",
  CACHE_TTL_SEGUNDOS: Number.isInteger(ttlCache) && ttlCache >= 1 ? ttlCache : 60,
};
