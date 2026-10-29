import { Router } from "express";
import healthRouter from "../controllers/health.controller.js";
import carrinhoRouter from "../controllers/carrinho.controller.js";
import pedidoRouter from "../controllers/pedido.controller.js";

const routes = Router();

routes.use("/health", healthRouter);
routes.use("/carrinho", carrinhoRouter);
routes.use("/pedidos", pedidoRouter);

export default routes;
