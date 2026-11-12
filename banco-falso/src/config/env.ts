import dotenv from "dotenv";
dotenv.config();

function inteiro(valor: string | undefined, padrao: number): number {
  const n = valor === undefined ? NaN : parseInt(valor, 10);
  return Number.isNaN(n) ? padrao : n;
}

export const env = {
  PORT: inteiro(process.env.PORT, 3000),
  NODE_ENV: process.env.NODE_ENV || "development",
  // Valores iniciais da simulação; mudam ao vivo com POST /config (aula 09, slide "BANCO-FALSO").
  LATENCIA_MS: inteiro(process.env.LATENCIA_MS, 0),
  FALHA_PERCENT: inteiro(process.env.FALHA_PERCENT, 0),
};
