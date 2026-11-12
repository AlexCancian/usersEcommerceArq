import { randomBytes } from "node:crypto";
import { env } from "../config/env.js";
import { BancoIndisponivelError, NotFoundError } from "../utils/errors.js";
import { CobrancaDTO, ConfigDTO, EstornoDTO } from "../utils/schemas.js";

// Aula 09, slide "BANCO-FALSO: O SISTEMA EXTERNO": sem banco de dados, tudo em memória.
// Reiniciar o container apaga as cobranças (é uma simulação).

export interface ConfigBanco {
  latenciaMs: number;
  falhaPercent: number;
}

export type RespostaCobranca =
  | { status: 201; corpo: { aprovado: true; codigo: string; referencia: string; valor: number } }
  | { status: 402; corpo: { aprovado: false; motivo: string } };

interface Cobranca {
  referencia: string;
  valor: number;
  resposta: RespostaCobranca;
  estornada: boolean;
}

const config: ConfigBanco = {
  latenciaMs: env.LATENCIA_MS,
  falhaPercent: env.FALHA_PERCENT,
};

// Chave de idempotência: referencia (o id do pedido) → a resposta já dada.
const cobrancas = new Map<string, Cobranca>();
const porCodigo = new Map<string, string>(); // codigo TX-... → referencia

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const CARTAO_SEM_SALDO = "0002";

const esperar = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function gerarCodigo(): string {
  return `TX-${randomBytes(3).toString("hex").toUpperCase()}`;
}

export const lerConfigService = (): ConfigBanco => ({ ...config });

export const mudarConfigService = (dados: ConfigDTO): ConfigBanco => {
  if (dados.latenciaMs !== undefined) config.latenciaMs = dados.latenciaMs;
  if (dados.falhaPercent !== undefined) config.falhaPercent = dados.falhaPercent;
  console.log(
    `[Banco] config: latenciaMs=${config.latenciaMs} falhaPercent=${config.falhaPercent}`
  );
  return { ...config };
};

// POST /cobrancas. A latência vem ANTES da decisão: se quem chama desistir (timeout),
// o banco cobra mesmo assim. É o cenário "timeout não é não aconteceu" da aula.
export const cobrarService = async (dados: CobrancaDTO): Promise<RespostaCobranca> => {
  if (config.latenciaMs > 0) await esperar(config.latenciaMs);

  const repetida = cobrancas.get(dados.referencia);
  if (repetida) {
    const codigo = repetida.resposta.status === 201 ? repetida.resposta.corpo.codigo : "recusada";
    console.log(
      `[Banco] cobrança ${dados.referencia} REPETIDA: devolvendo a mesma (${codigo}), sem cobrar de novo`
    );
    return repetida.resposta;
  }

  // Falha simulada: nada é gravado, a próxima tentativa pode dar certo.
  if (Math.random() * 100 < config.falhaPercent) {
    console.log(`[Banco] cobrança ${dados.referencia}: 503 (falha simulada)`);
    throw new BancoIndisponivelError();
  }

  const resposta: RespostaCobranca =
    dados.cartaoFinal === CARTAO_SEM_SALDO
      ? { status: 402, corpo: { aprovado: false, motivo: "saldo insuficiente" } }
      : {
          status: 201,
          corpo: { aprovado: true, codigo: gerarCodigo(), referencia: dados.referencia, valor: dados.valor },
        };

  cobrancas.set(dados.referencia, {
    referencia: dados.referencia,
    valor: dados.valor,
    resposta,
    estornada: false,
  });

  if (resposta.status === 201) {
    porCodigo.set(resposta.corpo.codigo, dados.referencia);
    console.log(
      `[Banco] cobrança ${dados.referencia} de ${moeda.format(dados.valor)}: aprovada (${resposta.corpo.codigo})`
    );
  } else {
    console.log(
      `[Banco] cobrança ${dados.referencia} de ${moeda.format(dados.valor)}: recusada (${resposta.corpo.motivo})`
    );
  }

  return resposta;
};

// POST /estornos. Idempotente: estornar de novo devolve o mesmo resultado.
// Não sofre latência nem falha simulada: devolver dinheiro é a compensação que precisa dar certo.
export const estornarService = (
  dados: EstornoDTO
): { estornado: true; codigo: string; referencia: string } => {
  const referencia = dados.referencia ?? (dados.codigo ? porCodigo.get(dados.codigo) : undefined);
  const cobranca = referencia ? cobrancas.get(referencia) : undefined;

  if (!cobranca || cobranca.resposta.status !== 201) {
    console.log(
      `[Banco] estorno sem cobrança aprovada (referencia=${dados.referencia ?? "-"} codigo=${dados.codigo ?? "-"}): 404`
    );
    throw new NotFoundError("Cobrança não encontrada para estorno.");
  }

  const codigo = cobranca.resposta.corpo.codigo;
  if (cobranca.estornada) {
    console.log(`[Banco] ESTORNO REPETIDO da cobrança ${codigo}: nada a fazer`);
  } else {
    cobranca.estornada = true;
    console.log(
      `[Banco] ESTORNO da cobrança ${codigo} (pedido ${cobranca.referencia}, ${moeda.format(cobranca.valor)})`
    );
  }

  return { estornado: true, codigo, referencia: cobranca.referencia };
};
