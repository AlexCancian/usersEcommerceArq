import dotenv from "dotenv";
dotenv.config();

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
};
