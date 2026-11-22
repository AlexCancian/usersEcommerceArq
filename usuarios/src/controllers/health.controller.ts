import { Router, Request, Response } from "express";
import { prisma } from "../config/db.js";
import { HealthUsuarios, StatusHealth, httpDoStatus, verificar } from "../utils/health.js";

const router = Router();

// GET /health (no gateway: /health/usuarios). Aula 10: só o banco, e ele é essencial.
router.get("/", async (_req: Request, res: Response) => {
  const banco = await verificar(() => prisma.$queryRaw`SELECT 1`);
  const status: StatusHealth = banco === "fora" ? "fora do ar" : "ok";

  const corpo = {
    servico: "usuarios",
    status,
    dependencias: { banco },
  } satisfies HealthUsuarios;

  res.setHeader("Cache-Control", "no-store");
  return res.status(httpDoStatus(status)).json(corpo);
});

export default router;
