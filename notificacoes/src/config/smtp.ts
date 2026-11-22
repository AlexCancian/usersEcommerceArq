import nodemailer from "nodemailer";
import { env } from "./env.js";
import { comLimite } from "../utils/health.js";

// Mailpit: recebe tudo e mostra numa caixa de entrada em localhost:8025. Nada sai para a internet.
export const smtp = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: false,
});

// ---- Health: smtp.verify() com limite de 2 s; resultado vale 5 s e chamadas simultâneas dividem a promessa.
let ultimoTeste: { quando: number; ok: boolean } | null = null;
let testeEmAndamento: Promise<boolean> | null = null;

async function testarSmtp(): Promise<boolean> {
  try {
    await comLimite(smtp.verify(), 2000);
    return true;
  } catch {
    return false;
  }
}

export function smtpDisponivel(): Promise<boolean> {
  if (ultimoTeste && Date.now() - ultimoTeste.quando < 5000) {
    return Promise.resolve(ultimoTeste.ok);
  }
  if (!testeEmAndamento) {
    testeEmAndamento = testarSmtp()
      .then((ok) => {
        ultimoTeste = { quando: Date.now(), ok };
        return ok;
      })
      .finally(() => {
        testeEmAndamento = null;
      });
  }
  return testeEmAndamento;
}
