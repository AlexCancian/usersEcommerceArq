import express from "express";
import { env } from "./config/env.js";
import routes from "./routes/routes.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { prisma } from "./config/db.js";
import { conectarProducer, desconectarKafka, garantirTopicos } from "./config/kafka.js";
import { iniciarConsumerEventos } from "./consumers/eventos.consumer.js";
import { desligarCircuito } from "./banco.js";

const app = express();

app.use(express.json());

app.use(routes);

app.use((_req, res) => {
  res.status(404).json({ erro: "Rota não encontrada." });
});

app.use(errorHandler);

const PORT = env.PORT || 3000;

async function iniciar(): Promise<void> {
  await prisma.$connect(); // banco primeiro
  await garantirTopicos(); // quem sobe primeiro cria os tópicos
  await conectarProducer(); // uma vez na subida, não a cada envio
  await iniciarConsumerEventos(); // groupId "pagamentos"

  const server = app.listen(PORT, () => {
    console.log(`💳 Servidor de pagamentos rodando na porta ${PORT}`);
  });

  // Desligar com calma: sem o disconnect, o Kafka espera ~30 s para repassar as partições.
  const encerrar = async (): Promise<void> => {
    server.close();
    await desconectarKafka();
    desligarCircuito();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.once("SIGTERM", () => void encerrar());
  process.once("SIGINT", () => void encerrar());
}

// restart: unless-stopped no compose tenta de novo se o Kafka/banco ainda não estiver pronto
iniciar().catch((erro) => {
  console.error("Falha ao iniciar o pagamentos:", erro);
  process.exit(1);
});

export default app;
