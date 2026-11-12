import express from "express";
import { env } from "./config/env.js";
import routes from "./routes/routes.js";
import { errorHandler } from "./middleware/errorHandler.js";

// Aula 09: o banco do cartão, um sistema que NÃO é nosso. Fica fora do Kong, com porta
// própria (9000 no host), e só o serviço pagamentos o chama pela rede interna.
const app = express();

app.use(express.json());
app.use(routes);

app.use((_req, res) => {
  res.status(404).json({ erro: "Rota não encontrada." });
});

app.use(errorHandler);

const server = app.listen(env.PORT, () => {
  console.log(`🏦 banco-falso rodando na porta ${env.PORT}`);
});

const encerrar = (): void => {
  server.close(() => process.exit(0));
};
process.once("SIGTERM", encerrar);
process.once("SIGINT", encerrar);
