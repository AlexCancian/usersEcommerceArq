import dotenv from "dotenv";
dotenv.config();

export const env = {
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  NODE_ENV: process.env.NODE_ENV || "development",
  DATABASE_URL:
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@localhost:5432/ecommerce_usuarios?schema=public",
  JWT_SECRET:
    process.env.JWT_SECRET || "ecommerce_secret_jwt_key_change_in_production",
};
