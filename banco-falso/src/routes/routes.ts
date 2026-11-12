import { Router } from "express";
import bancoRouter from "../controllers/banco.controller.js";

const routes = Router();

routes.use(bancoRouter);

export default routes;
