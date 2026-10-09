import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { AppError } from "../utils/errors.js";
import mongoose from "mongoose";

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Erros operacionais da aplicação
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

  // Erros do Zod não interceptados
  if (err instanceof ZodError) {
    const detalhes = err.errors.map((issue) => issue.message);
    return res.status(400).json({
      erro: "Dados inválidos.",
      detalhes,
    });
  }

  // Erro de índice único duplicado do MongoDB (E11000)
  if (err && (err.code === 11000 || err.name === "MongoServerError")) {
    if (err.keyPattern?.sku) {
      return res.status(409).json({
        erro: "Este SKU já está cadastrado.",
      });
    }
    if (err.keyPattern?.slug) {
      return res.status(409).json({
        erro: "Este slug de categoria já está cadastrado.",
      });
    }
    return res.status(409).json({
      erro: "Conflito: registro já existente.",
    });
  }

  // Erro de Cast do Mongoose (ID inválido)
  if (err instanceof mongoose.Error.CastError) {
    return res.status(404).json({
      erro: "Recurso não encontrado.",
    });
  }

  // Log do erro no servidor para depuração
  console.error("Erro interno não tratado no catalogo:", err);

  // NUNCA vazar stack trace ou detalhes do MongoDB para o cliente
  return res.status(500).json({
    erro: "Erro interno do servidor.",
  });
};
