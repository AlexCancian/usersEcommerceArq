import { Router } from "express";
import authRouter from "../controllers/auth.controller.js";
import usuarioRouter from "../controllers/usuario.controller.js";
import healthRouter from "../controllers/health.controller.js";

const routes = Router();

routes.use("/health", healthRouter);
routes.use("/auth", authRouter);
routes.use("/usuarios", usuarioRouter);

export default routes;
