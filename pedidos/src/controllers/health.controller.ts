import { Router, Request, Response } from "express";
import { prisma } from "../config/db.js";
import { kafkaDisponivel } from "../config/kafka.js";
import { HealthPedidos, StatusHealth, httpDoStatus, verificar } from "../utils/health.js";

const router = Router();

// GET /health (no gateway: /health/pedidos). Aula 10: ok | degradado | fora do ar.
// Essenciais: banco e kafka. Não consulta o catálogo (RN01): catálogo fora aparece como 503 no checkout.
router.get("/", async (_req: Request, res: Response) => {
  const [banco, kafka] = await Promise.all([
    verificar(() => prisma.$queryRaw`SELECT 1`),
    verificar(async () => {
      if (!(await kafkaDisponivel())) throw new Error("kafka fora");
    }),
  ]);

  const status: StatusHealth = banco === "fora" || kafka === "fora" ? "fora do ar" : "ok";

  const corpo = {
    servico: "pedidos",
    status,
    dependencias: { banco, kafka },
  } satisfies HealthPedidos;

  res.setHeader("Cache-Control", "no-store");
  return res.status(httpDoStatus(status)).json(corpo);
});

export default router;
