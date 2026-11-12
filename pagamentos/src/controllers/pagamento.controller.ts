import { Router, Response, NextFunction } from "express";
import { AuthenticatedRequest, lerIdentidade } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { pedidoIdParamSchema } from "../utils/schemas.js";
import {
  buscarPagamentoService,
  listarPagamentosService,
} from "../services/pagamento.service.js";

const router = Router();

// Identidade vem do Kong (X-User-*). GET /pagamentos é admin no Kong; /pagamentos/:pedidoId é logado.
router.use(lerIdentidade);

// GET /pagamentos - 200 todos (admin) · 403 cliente
router.get("/", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const pagamentos = await listarPagamentosService(req.user!);
    return res.status(200).json(pagamentos);
  } catch (error) {
    next(error);
  }
});

// GET /pagamentos/:pedidoId - 200 pagamento do pedido · 404 não existe ou não é seu
router.get(
  "/:pedidoId",
  validate(pedidoIdParamSchema),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const pagamento = await buscarPagamentoService(req.params.pedidoId, req.user!);
      return res.status(200).json(pagamento);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
