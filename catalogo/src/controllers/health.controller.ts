import { Router, Request, Response } from "express";
import mongoose from "mongoose";

const router = Router();

router.get("/", async (req: Request, res: Response) => {
  const isConnected = mongoose.connection.readyState === 1;

  if (isConnected) {
    return res.status(200).json({
      status: "ok",
      database: "connected",
    });
  }

  return res.status(500).json({
    status: "error",
    database: "disconnected",
  });
});

export default router;
