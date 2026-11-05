import nodemailer from "nodemailer";
import { env } from "./env.js";

// Mailpit: recebe tudo e mostra numa caixa de entrada em localhost:8025. Nada sai para a internet.
export const smtp = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: false,
});
