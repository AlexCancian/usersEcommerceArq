import { randomUUID } from "node:crypto";
import {
  Consumer,
  EachMessagePayload,
  Kafka,
  logLevel,
  Partitioners,
  Producer,
} from "kafkajs";
import { env } from "./env.js";
import {
  Envelope,
  EnvelopeRecebido,
  envelopeRecebidoSchema,
  Topico,
  TOPICOS,
} from "../utils/eventos.js";

// Cliente único por processo (aula 08, slide "KAFKAJS: PUBLICAR")
const kafka = new Kafka({
  clientId: "pagamentos",
  brokers: env.KAFKA_BROKERS,
  logLevel: logLevel.WARN,
});

// D25: murmur2, compatível com o cliente Java: hash(pedidoId) % partições estável
const producer: Producer = kafka.producer({
  createPartitioner: Partitioners.DefaultPartitioner,
});
let consumer: Consumer | null = null;
let producerConectado = false;

// Quem sobe primeiro cria os tópicos; "já existe" não é erro.
export async function garantirTopicos(): Promise<void> {
  const admin = kafka.admin();
  await admin.connect();
  try {
    const existentes = await admin.listTopics();
    const faltantes = Object.values(TOPICOS).filter((t) => !existentes.includes(t));
    if (faltantes.length > 0) {
      await admin.createTopics({
        topics: faltantes.map((topic) => ({
          topic,
          numPartitions: 3,
          replicationFactor: 1,
        })),
      });
    }
  } finally {
    await admin.disconnect();
  }
}

export async function conectarProducer(): Promise<void> {
  await producer.connect();
  producerConectado = true;
}

export async function publicar<TDados>(
  topico: Topico,
  tipo: string,
  pedidoId: string,
  dados: TDados,
  correlationId: string
): Promise<Envelope<TDados>> {
  const envelope: Envelope<TDados> = {
    id: randomUUID(),
    tipo,
    pedidoId,
    ocorridoEm: new Date().toISOString(),
    correlationId,
    dados,
  };

  await producer.send({
    topic: topico,
    messages: [{ key: pedidoId, value: JSON.stringify(envelope) }],
  });

  console.log(
    `[correlationId=${correlationId}] publicado ${tipo} pedidoId=${pedidoId} topico=${topico}`
  );
  return envelope;
}

export type HandlerEvento = (evento: EnvelopeRecebido) => Promise<void>;

function lerEnvelope(bruto: string | undefined): EnvelopeRecebido | string {
  if (!bruto) return "mensagem sem valor";
  let json: unknown;
  try {
    json = JSON.parse(bruto);
  } catch {
    return "JSON inválido";
  }
  const resultado = envelopeRecebidoSchema.safeParse(json);
  if (!resultado.success) {
    return resultado.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  }
  return resultado.data;
}

export async function iniciarConsumer(
  groupId: string,
  topicos: Topico[],
  handlers: Partial<Record<string, HandlerEvento>>
): Promise<void> {
  consumer = kafka.consumer({ groupId });
  await consumer.connect();
  for (const topic of topicos) {
    await consumer.subscribe({ topic, fromBeginning: true });
  }

  await consumer.run({
    eachMessage: async ({ topic, partition, message }: EachMessagePayload) => {
      const envelope = lerEnvelope(message.value?.toString());
      if (typeof envelope === "string") {
        // D06: mensagem inválida é descartada (sem DLQ); retry não a consertaria.
        console.error(
          `[correlationId=-] evento inválido descartado topico=${topic} offset=${message.offset}: ${envelope}`
        );
        return;
      }

      const tratar = handlers[envelope.tipo];
      if (!tratar) return; // tipo que não me interessa

      // Erro de infraestrutura: loga com o correlationId e relança, o kafkajs reentrega (pelo menos uma vez).
      try {
        await tratar(envelope);
      } catch (erro) {
        console.error(
          `[correlationId=${envelope.correlationId}] erro ao tratar ${envelope.tipo} pedidoId=${envelope.pedidoId} topico=${topic} particao=${partition} offset=${message.offset} (será reentregue):`,
          erro
        );
        throw erro;
      }
    },
  });
}

export async function desconectarKafka(): Promise<void> {
  if (consumer) {
    await consumer.disconnect();
    consumer = null;
  }
  if (producerConectado) {
    await producer.disconnect();
    producerConectado = false;
  }
}
