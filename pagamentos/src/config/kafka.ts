import { randomUUID } from "node:crypto";
import {
  Admin,
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
import { comLimite } from "../utils/health.js";
import { descreverErro, logEvento } from "../utils/log.js";

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

  logEvento("publicou", tipo, pedidoId, correlationId, { topico });
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

// Para o log de "descartou": pedidoId/correlationId do JSON bruto, só se forem strings seguras.
function extrairIds(bruto: string | undefined): { pedidoId: string | null; correlationId: string | null } {
  const vazio = { pedidoId: null, correlationId: null };
  if (!bruto) return vazio;
  try {
    const json: unknown = JSON.parse(bruto);
    if (typeof json !== "object" || json === null) return vazio;
    const { pedidoId, correlationId } = json as Record<string, unknown>;
    const seguro = (v: unknown): string | null =>
      typeof v === "string" && /^[A-Za-z0-9-]{1,64}$/.test(v) ? v : null;
    return { pedidoId: seguro(pedidoId), correlationId: seguro(correlationId) };
  } catch {
    return vazio;
  }
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
      const bruto = message.value?.toString();
      const envelope = lerEnvelope(bruto);
      if (typeof envelope === "string") {
        // D06: mensagem inválida é descartada (sem DLQ); retry não a consertaria.
        const ids = extrairIds(bruto);
        logEvento("descartou", "evento-invalido", ids.pedidoId, ids.correlationId, {
          topico: topic,
          offset: message.offset,
          motivo: envelope,
        });
        return;
      }

      const tratar = handlers[envelope.tipo];
      if (!tratar) return; // tipo que não me interessa

      logEvento("recebeu", envelope.tipo, envelope.pedidoId, envelope.correlationId, {
        topico: topic,
        particao: partition,
        offset: message.offset,
      });

      // Erro de infraestrutura: loga com o correlationId e relança, o kafkajs reentrega (pelo menos uma vez).
      try {
        await tratar(envelope);
      } catch (erro) {
        logEvento("falhou", envelope.tipo, envelope.pedidoId, envelope.correlationId, {
          topico: topic,
          particao: partition,
          offset: message.offset,
          erro: descreverErro(erro),
        });
        throw erro;
      }
    },
  });
}

// ---- Health: admin dedicado, sem retry; resultado vale 5 s e chamadas simultâneas dividem a mesma promessa.
let adminHealth: Admin | null = null;
let ultimoTeste: { quando: number; ok: boolean } | null = null;
let testeEmAndamento: Promise<boolean> | null = null;

async function testarKafka(): Promise<boolean> {
  try {
    if (!adminHealth) adminHealth = kafka.admin({ retry: { retries: 0 } });
    const admin = adminHealth;
    await comLimite(
      (async () => {
        await admin.connect();
        await admin.describeCluster();
      })(),
      2000
    );
    return true;
  } catch {
    // Descarta o admin para reconectar do zero na próxima checagem.
    const admin = adminHealth;
    adminHealth = null;
    if (admin) {
      await comLimite(admin.disconnect(), 1000).catch(() => undefined);
    }
    return false;
  }
}

export function kafkaDisponivel(): Promise<boolean> {
  if (ultimoTeste && Date.now() - ultimoTeste.quando < 5000) {
    return Promise.resolve(ultimoTeste.ok);
  }
  if (!testeEmAndamento) {
    testeEmAndamento = testarKafka()
      .then((ok) => {
        ultimoTeste = { quando: Date.now(), ok };
        return ok;
      })
      .finally(() => {
        testeEmAndamento = null;
      });
  }
  return testeEmAndamento;
}

export async function desconectarKafka(): Promise<void> {
  if (adminHealth) {
    await adminHealth.disconnect().catch(() => undefined);
    adminHealth = null;
  }
  if (consumer) {
    await consumer.disconnect();
    consumer = null;
  }
  if (producerConectado) {
    await producer.disconnect();
    producerConectado = false;
  }
}
