import { Router, Request, Response } from "express";
import { prisma } from "../config/db.js";
import { estadoCircuito } from "../banco.js";

const router = Router();

// GET /health (no gateway: /health/pagamentos). Aula 09, slide "ENXERGAR A FALHA":
// o estado do circuito aparece aqui para quem olha o painel saber na hora o que está acontecendo.
router.get("/", async (_req: Request, res: Response) => {
  const circuitoBancoExterno = estadoCircuito();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.status(200).json({ status: "ok", banco: "conectado", circuitoBancoExterno });
  } catch {
    return res.status(500).json({ status: "erro", banco: "desconectado", circuitoBancoExterno });
  }
});

export default router;
