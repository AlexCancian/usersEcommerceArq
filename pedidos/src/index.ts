import express from "express";
import { env } from "./config/env.js";
import routes from "./routes/routes.js";
import { errorHandler } from "./middleware/errorHandler.js";

const app = express();

app.use(express.json());

// Registro de rotas da aplicação
app.use(routes);

// Tratamento de rotas inexistentes (404)
app.use((_req, res) => {
  res.status(404).json({
    erro: "Rota não encontrada.",
  });
});

// Middleware global de tratamento de erros padronizado
app.use(errorHandler);

const PORT = env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor de pedidos rodando na porta ${PORT}`);
});

export default app;
