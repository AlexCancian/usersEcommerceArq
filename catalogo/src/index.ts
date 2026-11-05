import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { connectDatabase, disconnectDatabase } from "./config/db.js";
import { conectarProducer, desconectarKafka, garantirTopicos } from "./config/kafka.js";
import { iniciarConsumerPedidos } from "./consumers/pedidos.consumer.js";
import { Reserva } from "./models/reserva.model.js";
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

const PORT = env.PORT || 3000;

const startServer = async (): Promise<void> => {
  await connectDatabase();
  // D23: o índice único de reservas.pedidoId precisa existir antes do primeiro evento
  await Reserva.init();
  await garantirTopicos();
  await conectarProducer();
  await iniciarConsumerPedidos(); // groupId "catalogo"

  const server = app.listen(PORT, () => {
    console.log(`🚀 Servidor do catálogo rodando na porta ${PORT}`);
  });

  // Desligar com calma: sai do grupo na hora, sem esperar ~30 s para repassar as partições.
  const encerrar = async (): Promise<void> => {
    server.close();
    await desconectarKafka();
    await disconnectDatabase();
    process.exit(0);
  };
  process.once("SIGTERM", () => void encerrar());
  process.once("SIGINT", () => void encerrar());
};

// restart: unless-stopped no compose tenta de novo se o Kafka ainda não estiver pronto
startServer().catch((erro) => {
  console.error("Falha ao iniciar o catálogo:", erro);
  process.exit(1);
});

export default app;
