import { redis } from "../config/redis.js";
import { env } from "../config/env.js";
import { descreverErro, logEvento } from "../utils/log.js";

// Cache-aside com versão (aula 10, slides "O PADRÃO CACHE-ASIDE" e "VERSÃO NA PRÁTICA").
// Toda chave carrega a versão: invalidar = INCR catalogo:versao; as chaves antigas ficam órfãs e expiram sozinhas.

export type EstadoCache = "HIT" | "MISS" | "OFF";

export interface ResultadoCache {
  json: string; // corpo exato a enviar
  cache: EstadoCache; // vira o cabeçalho X-Cache
}

export interface ContextoEvento {
  pedidoId: string;
  correlationId: string;
}

const CHAVE_VERSAO = "catalogo:versao";

// TTL com variação de 0..9 s para as chaves não expirarem todas juntas.
function ttlComVariacao(): number {
  return env.CACHE_TTL_SEGUNDOS + Math.floor(Math.random() * 10);
}

// Coalescência: MISS simultâneos da mesma chave compartilham uma única consulta ao Mongo.
const emAndamento = new Map<string, Promise<ResultadoCache>>();
// Geração local: avança a cada invalidação deste processo. Entra na chave da coalescência para que
// uma leitura iniciada ANTES do INCR não seja reaproveitada por quem chegou DEPOIS (corpo antigo).
let geracaoLocal = 0;

async function executar(sufixo: string, buscar: () => Promise<unknown>): Promise<ResultadoCache> {
  let chave: string;

  // 1) Só Redis: versão e valor guardado. A versão é lida ANTES do Mongo.
  try {
    const versao = Number((await redis.get(CHAVE_VERSAO)) ?? 0);
    chave = `catalogo:v${Number.isFinite(versao) ? versao : 0}:${sufixo}`;
    const guardado = await redis.get(chave);
    if (guardado !== null) return { json: guardado, cache: "HIT" };
  } catch {
    // 2) Redis fora: responde pelo Mongo sem gravar nada.
    const valor = await buscar();
    return { json: JSON.stringify(valor), cache: "OFF" };
  }

  // 3) Não achou: busca no Mongo, fora de qualquer try do Redis (404 sobe e nada é gravado).
  const valor = await buscar();
  const json = JSON.stringify(valor);

  // 4) Só Redis: grava com TTL. Falha ao gravar não derruba a resposta.
  try {
    await redis.set(chave, json, "EX", ttlComVariacao());
    return { json, cache: "MISS" };
  } catch {
    return { json, cache: "OFF" };
  }
}

// `sufixo` é a parte depois de "catalogo:v<N>:" (ex.: "categorias", "produto:CEL-001").
export function lerOuBuscar(sufixo: string, buscar: () => Promise<unknown>): Promise<ResultadoCache> {
  const chaveCoalescencia = `${geracaoLocal}:${sufixo}`;
  const existente = emAndamento.get(chaveCoalescencia);
  if (existente) {
    // Quem esperou recebe o mesmo corpo; se a origem foi HIT/MISS/OFF, mantém.
    return existente;
  }
  const promessa = executar(sufixo, buscar).finally(() => {
    emAndamento.delete(chaveCoalescencia);
  });
  emAndamento.set(chaveCoalescencia, promessa);
  return promessa;
}

// INCR catalogo:versao depois da escrita bem-sucedida no Mongo. Nunca lança:
// erro do Redis vira log (o consumer não pode relançar por causa de cache).
export async function invalidarVitrine(motivo: string, contexto?: ContextoEvento): Promise<void> {
  geracaoLocal += 1;
  try {
    await redis.incr(CHAVE_VERSAO);
  } catch (erro) {
    logEvento("falhou", "cache.invalidar", contexto?.pedidoId ?? null, contexto?.correlationId ?? null, {
      motivo,
      erro: descreverErro(erro),
    });
  }
}

// Para o health: PING com o commandTimeout curto do cliente.
export async function redisDisponivel(): Promise<boolean> {
  try {
    return (await redis.ping()) === "PONG";
  } catch {
    return false;
  }
}
