import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { AppError } from "../utils/errors.js";
import { Prisma } from "@prisma/client";

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
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
    const detalhes = err.errors.map((issue) => issue.message);
    return res.status(400).json({
      erro: "Dados inválidos.",
      detalhes,
    });
  }

  // Erros do Prisma: Violação de Unique constraint (ex: e-mail já existe)
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return res.status(409).json({
        erro: "Este e-mail já está cadastrado.",
      });
    }

    if (err.code === "P2025") {
      return res.status(404).json({
        erro: "Registro não encontrado.",
      });
    }
  }

  // Erro 500 não tratado: NUNCA expor stack trace ou mensagem técnica do banco
  console.error("Erro interno não tratado:", err);

  return res.status(500).json({
    erro: "Erro interno do servidor.",
  });
};
