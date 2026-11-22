import { NextFunction, Request, Response } from "express";
import { lerRequestId } from "../utils/log.js";

// Uma linha por requisição, sem corpo, query, cabeçalhos ou IP. /health fica de fora (o Docker chama a cada 10 s).
export function requestLog(req: Request, res: Response, next: NextFunction): void {
  const inicio = process.hrtime.bigint();
  const caminho = req.path; // capturado agora: routers montados reescrevem req.url
  res.on("finish", () => {
    if (caminho === "/health" || caminho.startsWith("/health/")) return;
    const ms = Math.round(Number(process.hrtime.bigint() - inicio) / 1e6);
    const correlationId = lerRequestId(req.header("x-request-id")) ?? "-";
    console.log(
      `[pagamentos] HTTP ${req.method} ${caminho} ${res.statusCode} ${ms}ms correlationId=${correlationId}`
    );
  });
  next();
}
