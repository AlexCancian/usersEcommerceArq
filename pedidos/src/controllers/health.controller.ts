import { Router, Request, Response } from "express";
import { prisma } from "../config/db.js";

const router = Router();

// GET /health (no gateway: /health/pedidos)
router.get("/", async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.status(200).json({
      status: "ok",
      database: "connected",
    });
  } catch {
    return res.status(500).json({
      status: "error",
      database: "disconnected",
    });
  }
});

export default router;
