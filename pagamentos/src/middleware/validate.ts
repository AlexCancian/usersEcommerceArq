import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";

export const validate = (schema: ZodSchema) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const detalhes = error.errors.map((issue) => issue.message);
        return res.status(400).json({
          erro: "Dados inválidos.",
          detalhes,
        });
      }
      next(error);
    }
  };
};
