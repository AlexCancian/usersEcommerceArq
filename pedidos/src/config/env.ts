import dotenv from "dotenv";
dotenv.config();

export const env = {
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  NODE_ENV: process.env.NODE_ENV || "development",
  DATABASE_URL:
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@localhost:5432/ecommerce_pedidos?schema=public",
  // Chamada direta pela rede interna, sem passar pelo gateway (aula 07, slide 37)
  CATALOGO_URL: process.env.CATALOGO_URL || "http://catalogo:3000",
  // Kafka (aula 08): lista separada por vírgula
  KAFKA_BROKERS: (process.env.KAFKA_BROKERS || "kafka:9092")
    .split(",")
    .map((b) => b.trim())
    .filter(Boolean),
};
