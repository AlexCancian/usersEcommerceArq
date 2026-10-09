import { Router } from "express";
import healthRouter from "../controllers/health.controller.js";
import categoriaRouter from "../controllers/categoria.controller.js";
import produtoRouter from "../controllers/produto.controller.js";

const routes = Router();

routes.use("/health", healthRouter);
routes.use("/categorias", categoriaRouter);
routes.use("/produtos", produtoRouter);

export default routes;
