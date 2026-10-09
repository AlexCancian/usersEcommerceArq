import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { connectDatabase } from "./config/db.js";
import routes from "./routes/routes.js";
import { errorHandler } from "./middleware/errorHandler.js";

const app = express();

app.use(cors());
app.use(express.json());

// Rotas da aplicação
app.use(routes);

// Tratamento de rotas inexistentes (404)
app.use((req, res) => {
  res.status(404).json({
    erro: "Rota não encontrada.",
  });
});

// Middleware global de erros padronizado
app.use(errorHandler);

const PORT = env.PORT || 3002;

const startServer = async () => {
  await connectDatabase();

  app.listen(PORT, () => {
    console.log(`🚀 Servidor do catálogo rodando na porta ${PORT}`);
  });
};

startServer();

export default app;
