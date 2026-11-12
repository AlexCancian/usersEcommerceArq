import { Router, Response, NextFunction } from "express";
import { AuthenticatedRequest, lerIdentidade } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { checkoutSchema, pedidoIdParamSchema } from "../utils/schemas.js";
import {
  buscarPedidoService,
  cancelarPedidoService,
  checkoutService,
  listarPedidosService,
} from "../services/pedido.service.js";

const router = Router();

// Todas as rotas de pedidos são "logado": o Kong exige jwt e injeta X-User-*.
router.use(lerIdentidade);

// POST /pedidos - 202 aceito · 400 carrinho vazio · 409 produto indisponível · 503 catálogo fora
router.post(
  "/",
  validate(checkoutSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const pedido = await checkoutService(req.user!, req.body, req.header("x-request-id"));
      return res.status(202).json(pedido);
    } catch (error) {
      next(error);
    }
  }
);

// GET /pedidos - 200 meus pedidos
router.get("/", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const pedidos = await listarPedidosService(req.user!.id);
    return res.status(200).json(pedidos);
  } catch (error) {
    next(error);
  }
});

// GET /pedidos/:id - 200 pedido com itens · 404 não existe ou não é meu
router.get(
  "/:id",
  validate(pedidoIdParamSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const pedido = await buscarPedidoService(req.params.id, req.user!.id);
      return res.status(200).json(pedido);
    } catch (error) {
      next(error);
    }
  }
);

// POST /pedidos/:id/cancelar - 200 cancelado (publica pedido.cancelado) · 404 não é meu · 409 status não permite
router.post(
  "/:id/cancelar",
  validate(pedidoIdParamSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const pedido = await cancelarPedidoService(
        req.params.id,
        req.user!.id,
        req.header("x-request-id")
      );
      return res.status(200).json(pedido);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
