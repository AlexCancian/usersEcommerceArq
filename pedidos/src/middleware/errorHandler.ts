import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { AppError } from "../utils/errors.js";

export const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  // Erros operacionais lançados pela aplicação
  if (err instanceof AppError) {
    if (err.detalhes && err.detalhes.length > 0) {
      return res.status(err.statusCode).json({
        erro: err.message,
        detalhes: err.detalhes,
      });
    }
    return res.status(err.statusCode).json({
      erro: err.message,
    });
  }

  // Erros do Zod caso não tenham sido capturados pelo middleware validate
  if (err instanceof ZodError) {
    return res.status(400).json({
      erro: "Dados inválidos.",
      detalhes: err.errors.map((issue) => issue.message),
    });
  }

  // Corpo com JSON malformado (express.json)
  if (err instanceof SyntaxError) {
    return res.status(400).json({
      erro: "Corpo da requisição não é um JSON válido.",
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
    return res.status(404).json({
      erro: "Registro não encontrado.",
    });
  }

  // Erro 500 não tratado: NUNCA expor stack trace ou mensagem técnica do banco.
  // O x-request-id (correlation-id do Kong) permite achar a requisição nos logs de todos os serviços.
  console.error(
    `Erro interno não tratado no pedidos [x-request-id=${req.header("x-request-id") ?? "-"}]:`,
    err
  );

  return res.status(500).json({
    erro: "Erro interno do servidor.",
  });
};
