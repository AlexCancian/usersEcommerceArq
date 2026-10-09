import { Router, Request, Response, NextFunction } from "express";
import { validate } from "../middleware/validate.js";
import { createCategoriaSchema } from "../utils/schemas.js";
import {
  listCategoriasService,
  createCategoriaService,
} from "../services/categoria.service.js";

const router = Router();

// GET /categorias - Lista todas as categorias
router.get(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const categorias = await listCategoriasService();
      return res.status(200).json(categorias);
    } catch (error) {
      next(error);
    }
  }
);

// POST /categorias - Criação de categoria (Admin - aberta conforme slide 8)
router.post(
  "/",
  validate(createCategoriaSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const categoria = await createCategoriaService(req.body);
      return res.status(201).json(categoria);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
