import { desconectarKafka, garantirTopicos } from "./config/kafka.js";
import { smtp } from "./config/smtp.js";
import { iniciarConsumerEventos } from "./consumers/eventos.consumer.js";

// Serviço só de escuta: sem Express, sem porta, sem rota no Kong.
async function iniciar(): Promise<void> {
  await garantirTopicos();
  await iniciarConsumerEventos(); // groupId "notificacoes"
  console.log("📨 notificacoes ouvindo pedidos, estoque e pagamentos");

  // Desligar com calma: sai do grupo na hora, sem esperar ~30 s para repassar as partições.
  const encerrar = async (): Promise<void> => {
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
