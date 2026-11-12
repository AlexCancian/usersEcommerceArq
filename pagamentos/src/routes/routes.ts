import { Router } from "express";
import healthRouter from "../controllers/health.controller.js";
import pagamentoRouter from "../controllers/pagamento.controller.js";

const routes = Router();

routes.use("/health", healthRouter);
routes.use("/pagamentos", pagamentoRouter);

export default routes;
