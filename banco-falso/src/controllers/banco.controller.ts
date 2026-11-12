import { Router, Request, Response, NextFunction } from "express";
import { validate } from "../middleware/validate.js";
import { cobrancaSchema, configSchema, estornoSchema } from "../utils/schemas.js";
import {
  cobrarService,
  estornarService,
  lerConfigService,
  mudarConfigService,
} from "../services/banco.service.js";

const router = Router();

// POST /cobrancas - 201 aprovada · 402 cartão final 0002 · 503 falha simulada · 400 dados inválidos
router.post(
  "/cobrancas",
  validate(cobrancaSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const resposta = await cobrarService(req.body);
      return res.status(resposta.status).json(resposta.corpo);
    } catch (error) {
      next(error);
    }
  }
);

// POST /estornos - 201 estornado · 404 sem cobrança aprovada para a referência/código
router.post(
  "/estornos",
  validate(estornoSchema),
  (req: Request, res: Response, next: NextFunction) => {
    try {
      return res.status(201).json(estornarService(req.body));
    } catch (error) {
      next(error);
    }
  }
);

// GET /config - 200 { latenciaMs, falhaPercent }
router.get("/config", (_req: Request, res: Response) => {
  return res.status(200).json(lerConfigService());
});

// POST /config - 200 nova config · 400 valores fora da faixa
router.post("/config", validate(configSchema), (req: Request, res: Response) => {
  return res.status(200).json(mudarConfigService(req.body));
});

// GET /health
router.get("/health", (_req: Request, res: Response) => {
  return res.status(200).json({ status: "ok", ...lerConfigService() });
});

export default router;
