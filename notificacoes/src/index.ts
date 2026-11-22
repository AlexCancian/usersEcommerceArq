import { desconectarKafka, garantirTopicos } from "./config/kafka.js";
import { smtp } from "./config/smtp.js";
import { env } from "./config/env.js";
import { iniciarServidorHealth } from "./health.js";
import { iniciarConsumerEventos } from "./consumers/eventos.consumer.js";

// Serviço de escuta: sem Express, sem rota de negócio; HTTP só para /health (node:http).
async function iniciar(): Promise<void> {
  await garantirTopicos();
  await iniciarConsumerEventos(); // groupId "notificacoes"
  console.log("📨 notificacoes ouvindo pedidos, estoque e pagamentos");
  const server = iniciarServidorHealth(env.PORT);

  // Desligar com calma: sai do grupo na hora, sem esperar ~30 s para repassar as partições.
  const encerrar = async (): Promise<void> => {
    server.close();
    await desconectarKafka();
    smtp.close();
    process.exit(0);
  };
  process.once("SIGTERM", () => void encerrar());
  process.once("SIGINT", () => void encerrar());
}

// restart: unless-stopped no compose tenta de novo se o Kafka ainda não estiver pronto
iniciar().catch((erro) => {
  console.error("Falha ao iniciar o notificacoes:", erro);
  process.exit(1);
});
