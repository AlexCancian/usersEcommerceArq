import { Router, Request, Response } from "express";
import mongoose from "mongoose";
import { kafkaDisponivel } from "../config/kafka.js";
import { redisDisponivel } from "../services/cache.service.js";
import { HealthCatalogo, StatusHealth, httpDoStatus, verificar } from "../utils/health.js";

const router = Router();

// GET /health (no gateway: /health/catalogo). Aula 10: ok | degradado | fora do ar.
// Essenciais: banco e kafka (fora = 503). Não essencial: cache (fora = degradado, 200).
// Não chama nenhum outro serviço; checagens em paralelo, cada uma com limite de 2 s.
router.get("/", async (_req: Request, res: Response) => {
  const [banco, kafka, cache] = await Promise.all([
    verificar(async () => {
      if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
        throw new Error("mongo desconectado");
      }
      await mongoose.connection.db.admin().ping();
    }),
    verificar(async () => {
      if (!(await kafkaDisponivel())) throw new Error("kafka fora");
    }),
    verificar(async () => {
      if (!(await redisDisponivel())) throw new Error("redis fora");
    }),
  ]);

  let status: StatusHealth = "ok";
  if (banco === "fora" || kafka === "fora") status = "fora do ar";
  else if (cache === "fora") status = "degradado";

  const corpo = {
    servico: "catalogo",
    status,
    dependencias: { banco, kafka, cache },
  } satisfies HealthCatalogo;

  res.setHeader("Cache-Control", "no-store");
  return res.status(httpDoStatus(status)).json(corpo);
});

export default router;
