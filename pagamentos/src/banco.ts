import CircuitBreaker from "opossum";
import { z } from "zod";
import { env } from "./config/env.js";

// Aula 09: a chamada ao banco do cartão (sistema externo) com os três padrões de resiliência.
//   timeout          : AbortSignal.timeout(2000) em toda chamada
//   retry com backoff: até 3 tentativas, esperando 500 ms e 1 s (+ jitter), só para timeout, erro de rede e 5xx
//   circuit breaker  : opossum, abre com 50% de falha em pelo menos 5 chamadas, meio-aberto depois de 15 s
// O retry fica só aqui (pagamentos → banco): a camada mais próxima de quem falha.

const TIMEOUT_MS = 2000;
const MAX_TENTATIVAS = 3;
const ESPERA_BASE_MS = 500;
const JITTER_MAX_MS = 200;

export interface DadosCobranca {
  valor: number;
  cartaoFinal: string | null;
  referencia: string; // id do pedido = chave de idempotência no banco
  correlationId: string;
}

type RespostaBanco =
  | { tipo: "aprovado"; codigo: string }
  | { tipo: "recusado"; motivo: string };

export type ResultadoCobranca =
  | { tipo: "aprovado"; codigo: string; tentativas: number }
  | { tipo: "recusado"; motivo: string; tentativas: number }
  // incerto: alguma tentativa ficou sem resposta. O banco PODE ter cobrado ("timeout não é não aconteceu").
  | { tipo: "erro"; motivo: string; tentativas: number; incerto: boolean };

export type ResultadoEstorno = "estornado" | "sem-cobranca";

// Falha que vale repetir (e que conta para o circuito).
class FalhaBanco extends Error {
  constructor(
    motivo: string,
    public readonly incerto: boolean
  ) {
    super(motivo);
  }
}

const aprovadoSchema = z.object({ codigo: z.string().min(1) });
const recusadoSchema = z.object({ motivo: z.string().min(1) });
const estornoSchema = z.object({ estornado: z.literal(true) });

const esperar = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function nomeDoErro(erro: unknown): string | undefined {
  if (typeof erro === "object" && erro !== null && "name" in erro && typeof erro.name === "string") {
    return erro.name;
  }
  return undefined;
}

function codigoDoErro(erro: unknown): string | undefined {
  if (typeof erro === "object" && erro !== null && "code" in erro && typeof erro.code === "string") {
    return erro.code;
  }
  return undefined;
}

async function post(caminho: string, corpo: object, correlationId: string): Promise<Response> {
  try {
    return await fetch(`${env.BANCO_URL}${caminho}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": correlationId },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(TIMEOUT_MS), // desiste em 2 s
    });
  } catch (erro) {
    if (nomeDoErro(erro) === "TimeoutError") {
      throw new FalhaBanco(`sem resposta em ${TIMEOUT_MS} ms (timeout)`, true);
    }
    // Conexão recusada, DNS, conexão caída no meio: pode ou não ter chegado ao banco.
    throw new FalhaBanco("erro de rede", true);
  }
}

async function lerJson(resposta: Response): Promise<unknown> {
  try {
    return await resposta.json();
  } catch {
    return null;
  }
}

// Uma tentativa. 402 e outros 4xx são RESPOSTAS (sucesso para o circuito, sem retry).
async function chamarCobranca(dados: DadosCobranca): Promise<RespostaBanco> {
  const resposta = await post(
    "/cobrancas",
    { valor: dados.valor, cartaoFinal: dados.cartaoFinal, referencia: dados.referencia },
    dados.correlationId
  );

  if (resposta.status >= 500) {
    throw new FalhaBanco(`banco respondeu HTTP ${resposta.status}`, false);
  }

  const corpo = await lerJson(resposta);

  if (resposta.status === 200 || resposta.status === 201) {
    const aprovado = aprovadoSchema.safeParse(corpo);
    if (!aprovado.success) throw new FalhaBanco("resposta inválida do banco", true);
    return { tipo: "aprovado", codigo: aprovado.data.codigo };
  }

  if (resposta.status === 402) {
    const recusado = recusadoSchema.safeParse(corpo);
    return {
      tipo: "recusado",
      motivo: recusado.success ? recusado.data.motivo : "pagamento recusado pelo banco",
    };
  }

  return { tipo: "recusado", motivo: `banco recusou a cobrança (HTTP ${resposta.status})` };
}

// Um disjuntor por réplica (aula 09, resposta 4: para o projeto, está bom).
const disjuntor = new CircuitBreaker<[DadosCobranca], RespostaBanco>(chamarCobranca, {
  timeout: 2500, // o opossum também corta (acima dos 2 s do fetch)
  errorThresholdPercentage: 50, // abre com 50% de falha...
  volumeThreshold: 5, // ...em pelo menos 5 chamadas
  resetTimeout: 15000, // 15 s até o meio-aberto
});

disjuntor.on("open", () =>
  console.warn("[pagamentos] CIRCUITO ABERTO: banco externo falhando, cobranças falham na hora por 15 s")
);
disjuntor.on("halfOpen", () =>
  console.warn("[pagamentos] CIRCUITO MEIO-ABERTO: a próxima cobrança testa o banco")
);
disjuntor.on("close", () => console.log("[pagamentos] CIRCUITO FECHADO: banco externo respondendo"));

export function estadoCircuito(): "fechado" | "aberto" | "meio-aberto" {
  if (disjuntor.opened) return "aberto";
  if (disjuntor.halfOpen) return "meio-aberto";
  return "fechado";
}

export function desligarCircuito(): void {
  disjuntor.shutdown();
}

// Timeout por chamada, retry por cima, circuit breaker em volta.
export async function cobrar(dados: DadosCobranca): Promise<ResultadoCobranca> {
  const log = `[correlationId=${dados.correlationId}] cobrança pedidoId=${dados.referencia}`;
  let ultimoMotivo = "sem resposta";
  let incerto = false;
  let tentativas = 0;

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    try {
      tentativas = tentativa;
      const resposta = await disjuntor.fire(dados);
      console.log(
        `${log} tentativa ${tentativa}/${MAX_TENTATIVAS}: ${resposta.tipo === "aprovado" ? `aprovada (${resposta.codigo})` : `recusada (${resposta.motivo})`}`
      );
      return { ...resposta, tentativas: tentativa };
    } catch (erro) {
      // Circuito aberto: falha na hora, sem chamar o banco. O retry nem tenta.
      if (codigoDoErro(erro) === "EOPENBREAKER") {
        tentativas = tentativa - 1;
        ultimoMotivo = "circuito aberto";
        console.warn(`${log} tentativa ${tentativa}/${MAX_TENTATIVAS} não feita: circuito aberto`);
        break;
      }

      if (erro instanceof FalhaBanco) {
        ultimoMotivo = erro.message;
        incerto = incerto || erro.incerto;
      } else if (codigoDoErro(erro) === "ETIMEDOUT") {
        ultimoMotivo = "sem resposta (timeout do circuit breaker)";
        incerto = true;
      } else {
        ultimoMotivo = "erro inesperado na chamada ao banco";
        incerto = true;
        console.error(`${log} erro inesperado:`, erro);
      }

      console.warn(`${log} tentativa ${tentativa}/${MAX_TENTATIVAS} falhou: ${ultimoMotivo}`);

      if (tentativa < MAX_TENTATIVAS) {
        // Espera crescente (500 ms, 1 s) + jitter
        const espera = ESPERA_BASE_MS * 2 ** (tentativa - 1) + Math.floor(Math.random() * JITTER_MAX_MS);
        await esperar(espera);
      }
    }
  }

  return {
    tipo: "erro",
    motivo: `banco indisponível (${ultimoMotivo})`,
    tentativas,
    incerto,
  };
}

// Compensação: devolver dinheiro não passa pelo circuit breaker (aula 09).
// Idempotente pela referência; 404 = não havia cobrança aprovada, e tudo bem.
// Esgotou as tentativas: lança erro (quem chama decide: o consumer relança e o Kafka reentrega).
export async function estornar(
  referencia: string,
  codigo: string | null,
  correlationId: string
): Promise<ResultadoEstorno> {
  const log = `[correlationId=${correlationId}] estorno pedidoId=${referencia}`;
  let ultimoMotivo = "sem resposta";

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    try {
      const resposta = await post("/estornos", { referencia, codigo }, correlationId);

      if (resposta.status === 404) {
        console.log(`${log}: banco não tem cobrança aprovada (404), nada a devolver`);
        return "sem-cobranca";
      }
      if (resposta.status >= 500) {
        throw new FalhaBanco(`banco respondeu HTTP ${resposta.status}`, false);
      }
      if (resposta.status !== 200 && resposta.status !== 201) {
        throw new Error(`banco recusou o estorno (HTTP ${resposta.status})`);
      }
      if (!estornoSchema.safeParse(await lerJson(resposta)).success) {
        throw new FalhaBanco("resposta inválida do banco", true);
      }

      console.log(`${log} tentativa ${tentativa}/${MAX_TENTATIVAS}: estornado`);
      return "estornado";
    } catch (erro) {
      if (!(erro instanceof FalhaBanco)) throw erro; // 4xx inesperado: repetir não muda o "não"
      ultimoMotivo = erro.message;
      console.warn(`${log} tentativa ${tentativa}/${MAX_TENTATIVAS} falhou: ${ultimoMotivo}`);
      if (tentativa < MAX_TENTATIVAS) {
        await esperar(ESPERA_BASE_MS * 2 ** (tentativa - 1) + Math.floor(Math.random() * JITTER_MAX_MS));
      }
    }
  }

  throw new Error(`estorno falhou depois de ${MAX_TENTATIVAS} tentativas: ${ultimoMotivo}`);
}
