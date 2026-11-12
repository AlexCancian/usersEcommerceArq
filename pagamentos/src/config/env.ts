import dotenv from "dotenv";
dotenv.config();

export const env = {
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  NODE_ENV: process.env.NODE_ENV || "development",
  DATABASE_URL:
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@localhost:5432/ecommerce_pagamentos?schema=public",
  // Kafka (aula 08): lista separada por vírgula
  KAFKA_BROKERS: (process.env.KAFKA_BROKERS || "kafka:9092")
    .split(",")
    .map((b) => b.trim())
    .filter(Boolean),
  // Banco do cartão (aula 09): sistema externo, chamado direto pela rede interna
  BANCO_URL: process.env.BANCO_URL || "http://banco-falso:3000",
};
