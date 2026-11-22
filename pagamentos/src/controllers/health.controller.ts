import { Router, Request, Response } from "express";
import { prisma } from "../config/db.js";
import { kafkaDisponivel } from "../config/kafka.js";
import { estadoCircuito } from "../banco.js";
import { HealthPagamentos, StatusHealth, httpDoStatus, verificar } from "../utils/health.js";

const router = Router();

// GET /health (no gateway: /health/pagamentos). Aula 10: ok | degradado | fora do ar.
// Essenciais: banco e kafka. Circuito ABERTO ou MEIO-ABERTO = degradado (200).
// O circuito é lido da memória: o health não chama o banco-falso.
router.get("/", async (_req: Request, res: Response) => {
  const circuitoBancoCartao = estadoCircuito();
  const [banco, kafka] = await Promise.all([
    verificar(() => prisma.$queryRaw`SELECT 1`),
    verificar(async () => {
      if (!(await kafkaDisponivel())) throw new Error("kafka fora");
    }),
  ]);

  let status: StatusHealth = "ok";
  if (banco === "fora" || kafka === "fora") status = "fora do ar";
  else if (circuitoBancoCartao !== "FECHADO") status = "degradado";

  const corpo = {
    servico: "pagamentos",
    status,
    dependencias: { banco, kafka, circuitoBancoCartao },
  } satisfies HealthPagamentos;

  res.setHeader("Cache-Control", "no-store");
  return res.status(httpDoStatus(status)).json(corpo);
});

export default router;
