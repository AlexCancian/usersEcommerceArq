import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import routes from "./routes/routes.js";
import { errorHandler } from "./middleware/errorHandler.js";

const app = express();

app.use(cors());
app.use(express.json());

// Registro de rotas da aplicação
app.use(routes);

// Tratamento de rotas inexistentes (404)
app.use((req, res) => {
  res.status(404).json({
    erro: "Rota não encontrada.",
  });
});

// Middleware global de tratamento de erros padronizado
app.use(errorHandler);

const PORT = env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`🚀 Servidor de usuários rodando na porta ${PORT}`);
});

export default app;
