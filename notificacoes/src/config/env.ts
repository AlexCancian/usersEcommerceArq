import dotenv from "dotenv";
dotenv.config();

export const env = {
  NODE_ENV: process.env.NODE_ENV || "development",
  // Kafka (aula 08): lista separada por vírgula
  KAFKA_BROKERS: (process.env.KAFKA_BROKERS || "kafka:9092")
    .split(",")
    .map((b) => b.trim())
    .filter(Boolean),
  // Mailpit: servidor de e-mail de mentira (SMTP 1025 só na rede interna)
  SMTP_HOST: process.env.SMTP_HOST || "mailpit",
  SMTP_PORT: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 1025,
  MAIL_FROM: process.env.MAIL_FROM || "Loja <nao-responda@loja.com>",
};
