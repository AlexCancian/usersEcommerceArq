import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/errors.js";
import { descreverErro, lerRequestId } from "../utils/log.js";

export const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  if (err instanceof AppError) {
    if (err.detalhes && err.detalhes.length > 0) {
      return res.status(err.statusCode).json({ erro: err.message, detalhes: err.detalhes });
    }
    return res.status(err.statusCode).json({ erro: err.message });
  }

  if (err instanceof SyntaxError) {
    return res.status(400).json({ erro: "Corpo da requisição não é um JSON válido." });
  }

  console.error(
    `[banco-falso] erro 500 ${req.method} ${req.path} correlationId=${lerRequestId(req.header("x-request-id")) ?? "-"} erro=${descreverErro(err)}`
  );
  return res.status(500).json({ erro: "Erro interno do servidor." });
};
