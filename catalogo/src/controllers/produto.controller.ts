import { Router, Request, Response, NextFunction } from "express";
import { validate } from "../middleware/validate.js";
import {
  createProdutoSchema,
  updateProdutoSchema,
  patchEstoqueSchema,
  idParamSchema,
  queryProdutoSchema,
} from "../utils/schemas.js";
import {
  listProdutosAtivosService,
  getProdutoByIdService,
  createProdutoService,
  updateProdutoService,
  ajustarEstoqueService,
  desativarProdutoService,
} from "../services/produto.service.js";

const router = Router();

// GET /produtos?categoria=&busca=&ids= - Listar produtos ativos (Público)
router.get(
  "/",
  validate(queryProdutoSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { categoria, busca, ids } = req.query as {
        categoria?: string;
        busca?: string;
        ids?: string;
      };
      const produtos = await listProdutosAtivosService({
        categoria,
        busca,
        ids: ids
          ? ids.split(",").map((id) => id.trim()).filter((id) => id.length > 0)
          : undefined,
      });
      return res.status(200).json(produtos);
    } catch (error) {
      next(error);
    }
  }
);

// GET /produtos/:id - Buscar produto por ID ou SKU (Público)
router.get(
  "/:id",
  validate(idParamSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const produto = await getProdutoByIdService(req.params.id);
      return res.status(200).json(produto);
    } catch (error) {
      next(error);
    }
  }
);

// POST /produtos - Criar novo produto (admin: o Kong exige jwt + acl allow [admin])
router.post(
  "/",
  validate(createProdutoSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const produto = await createProdutoService(req.body);
      return res.status(201).json(produto);
    } catch (error) {
      next(error);
    }
  }
);

// PUT /produtos/:id - Atualizar produto completo (admin: o Kong exige jwt + acl allow [admin])
router.put(
  "/:id",
  validate(idParamSchema),
  validate(updateProdutoSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const produto = await updateProdutoService(req.params.id, req.body);
      return res.status(200).json(produto);
    } catch (error) {
      next(error);
    }
  }
);

// PATCH /produtos/:id/estoque - Ajustar estoque de produto (admin: o Kong exige jwt + acl allow [admin])
router.patch(
  "/:id/estoque",
  validate(idParamSchema),
  validate(patchEstoqueSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const produto = await ajustarEstoqueService(req.params.id, req.body);
      return res.status(200).json(produto);
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /produtos/:id - Desativar produto (Soft Delete) (admin: o Kong exige jwt + acl allow [admin])
router.delete(
  "/:id",
  validate(idParamSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await desativarProdutoService(req.params.id);
      return res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

export default router;
