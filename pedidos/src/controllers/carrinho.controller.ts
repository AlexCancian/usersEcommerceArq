import { Router, Response, NextFunction } from "express";
import { AuthenticatedRequest, lerIdentidade } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { adicionarItemSchema, produtoIdParamSchema } from "../utils/schemas.js";
import {
  adicionarItemService,
  removerItemService,
  verCarrinhoService,
} from "../services/carrinho.service.js";

const router = Router();

// Todas as rotas do carrinho são "logado": o Kong exige jwt e injeta X-User-*.
router.use(lerIdentidade);

// GET /carrinho - 200 { itens, total } com preços atuais do catálogo
router.get("/", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const carrinho = await verCarrinhoService(req.user!.id, req.header("x-request-id"));
    return res.status(200).json(carrinho);
  } catch (error) {
    next(error);
  }
});

// POST /carrinho/itens - 201 item adicionado · 400 quantidade inválida · 404 produto não existe
router.post(
  "/itens",
  validate(adicionarItemSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const item = await adicionarItemService(
        req.user!.id,
        req.body,
        req.header("x-request-id")
      );
      return res.status(201).json(item);
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /carrinho/itens/:produtoId - 204 removido · 404 não está no carrinho
router.delete(
  "/itens/:produtoId",
  validate(produtoIdParamSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      await removerItemService(req.user!.id, req.params.produtoId);
      return res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

export default router;
