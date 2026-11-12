import { Prisma, StatusPagamento } from "@prisma/client";
import { z } from "zod";
import { cobrar, estornar } from "../banco.js";
import { publicar } from "../config/kafka.js";
import { UsuarioIdentidade } from "../middleware/auth.js";
import {
  buscarPorPedido,
  buscarPorPedidoDoUsuario,
  inserirSeNaoExiste,
  listarTodos,
  mudarStatus,
  PagamentoView,
} from "../repositories/pagamento.repository.js";
import { ForbiddenError, NotFoundError } from "../utils/errors.js";
import {
  EnvelopeRecebido,
  EstoqueReservadoDados,
  PagamentoAprovadoDados,
  PagamentoEstornadoDados,
  PagamentoRecusadoDados,
  PedidoCanceladoDados,
  TIPOS,
  TOPICOS,
} from "../utils/eventos.js";

const uuidSchema = z.string().uuid();
const LIMITE_MOTIVO = 500;

// Quem é o cliente da cobrança: vem no evento, sem consultar outro serviço.
interface Cliente {
  usuarioId: string;
  clienteEmail: string;
}

const logDe = (correlationId: string, pedidoId: string): string =>
  `[correlationId=${correlationId}] pedidoId=${pedidoId}`;

async function publicarAprovado(
  pedidoId: string,
  cliente: Cliente,
  valor: number,
  codigoTransacao: string,
  tentativas: number,
  correlationId: string
): Promise<void> {
  await publicar<PagamentoAprovadoDados>(
    TOPICOS.PAGAMENTOS,
    TIPOS.PAGAMENTO_APROVADO,
    pedidoId,
    { ...cliente, valor, codigoTransacao, tentativas },
    correlationId
  );
}

async function publicarRecusado(
  pedidoId: string,
  cliente: Cliente,
  valor: number,
  motivo: string,
  tentativas: number,
  correlationId: string
): Promise<void> {
  await publicar<PagamentoRecusadoDados>(
    TOPICOS.PAGAMENTOS,
    TIPOS.PAGAMENTO_RECUSADO,
    pedidoId,
    { ...cliente, valor, motivo, tentativas },
    correlationId
  );
}

// Reentrega de um evento já processado: republica o resultado gravado.
// Cobre a falha "gravou o status, mas o Kafka caiu antes de publicar". Os consumers são idempotentes.
async function republicarResultado(
  pagamento: PagamentoView,
  cliente: Cliente,
  correlationId: string
): Promise<void> {
  const valor = pagamento.valor.toNumber();
  if (pagamento.status === StatusPagamento.APROVADO && pagamento.codigo_transacao) {
    await publicarAprovado(
      pagamento.pedido_id,
      cliente,
      valor,
      pagamento.codigo_transacao,
      pagamento.tentativas,
      correlationId
    );
    return;
  }
  await publicarRecusado(
    pagamento.pedido_id,
    cliente,
    valor,
    pagamento.motivo ?? "pagamento recusado",
    pagamento.tentativas,
    correlationId
  );
}

// Compensação: estorna no banco, grava ESTORNADO e publica pagamento.estornado.
// Se o estorno falhar, o erro sobe: o consumer relança e o Kafka reentrega (compensação tenta até conseguir).
async function estornarERegistrar(
  pedidoId: string,
  codigo: string,
  valor: number,
  cliente: Cliente,
  correlationId: string
): Promise<void> {
  const log = logDe(correlationId, pedidoId);
  await estornar(pedidoId, codigo, correlationId);

  const alterados = await mudarStatus(
    pedidoId,
    [StatusPagamento.APROVADO, StatusPagamento.CANCELADO],
    { status: StatusPagamento.ESTORNADO, motivo: "pedido cancelado pelo cliente: cobrança estornada" }
  );
  if (alterados === 0) {
    console.log(`${log} estorno já registrado antes (evento repetido)`);
    return;
  }

  console.log(`${log} COMPENSAÇÃO: cobrança ${codigo} estornada → ESTORNADO`);
  await publicar<PagamentoEstornadoDados>(
    TOPICOS.PAGAMENTOS,
    TIPOS.PAGAMENTO_ESTORNADO,
    pedidoId,
    { ...cliente, valor, codigoTransacao: codigo },
    correlationId
  );
}

// Aula 09, slide "PAGAMENTOS: AO RECEBER ESTOQUE.RESERVADO".
// 1) idempotência pelo pedido_id UNIQUE; 2) timeout + retry + circuit breaker; 3) o resultado vira evento.
export const processarEstoqueReservadoService = async (
  evento: EnvelopeRecebido,
  dados: EstoqueReservadoDados
): Promise<void> => {
  const { pedidoId, correlationId } = evento;
  const log = logDe(correlationId, pedidoId);
  const cliente: Cliente = { usuarioId: dados.usuarioId, clienteEmail: dados.clienteEmail };
  const valorDecimal = new Prisma.Decimal(dados.valorTotal).toDecimalPlaces(2);
  const valor = valorDecimal.toNumber();
  const cartaoFinal = dados.cartaoFinal ?? null;

  const gravou = await inserirSeNaoExiste({
    pedido_id: pedidoId,
    usuario_id: dados.usuarioId,
    valor: valorDecimal,
    forma: dados.formaPagamento,
    cartao_final: cartaoFinal,
    status: StatusPagamento.PENDENTE,
  });

  if (!gravou) {
    const existente = await buscarPorPedido(pedidoId);
    if (!existente) return;

    switch (existente.status) {
      case StatusPagamento.PENDENTE:
        // Caiu no meio da cobrança: repete. O banco reconhece a referência e não cobra duas vezes.
        console.log(`${log} estoque.reservado reentregue com pagamento PENDENTE: retomando a cobrança`);
        break;
      case StatusPagamento.APROVADO:
      case StatusPagamento.RECUSADO:
      case StatusPagamento.ERRO:
        console.log(
          `${log} estoque.reservado repetido: pagamento já ${existente.status}, sem cobrar de novo (republicando o resultado)`
        );
        await republicarResultado(existente, cliente, correlationId);
        return;
      case StatusPagamento.CANCELADO:
        // Cancelado durante uma cobrança que aprovou e cujo estorno ainda não terminou: tenta de novo.
        if (existente.codigo_transacao) {
          await estornarERegistrar(pedidoId, existente.codigo_transacao, valor, cliente, correlationId);
          return;
        }
        console.log(`${log} estoque.reservado ignorado: pedido cancelado antes da cobrança, o banco não é chamado`);
        return;
      default:
        console.log(`${log} estoque.reservado ignorado: pagamento já ${existente.status}`);
        return;
    }
  } else {
    console.log(`${log} pagamento PENDENTE gravado, cobrando no banco (${dados.formaPagamento})`);
  }

  const resultado = await cobrar({ valor, cartaoFinal, referencia: pedidoId, correlationId });

  let status: StatusPagamento;
  let motivo: string | null = null;
  let codigo: string | null = null;

  if (resultado.tipo === "aprovado") {
    status = StatusPagamento.APROVADO;
    codigo = resultado.codigo;
  } else if (resultado.tipo === "recusado") {
    status = StatusPagamento.RECUSADO;
    motivo = resultado.motivo;
  } else {
    status = StatusPagamento.ERRO;
    motivo = resultado.motivo;
    // Desistiu sem saber? Desfaz por segurança: se não havia cobrança, o banco responde 404 e tudo bem.
    if (resultado.incerto) {
      try {
        const estorno = await estornar(pedidoId, null, correlationId);
        if (estorno === "estornado") {
          motivo = `${motivo}; a cobrança feita sem resposta foi estornada por segurança`;
          console.warn(`${log} COMPENSAÇÃO: o banco tinha cobrado sem responder, estorno por segurança feito`);
        }
      } catch (erro) {
        // Fica para a conciliação (limitação conhecida: não há ESTORNO_PENDENTE).
        console.error(
          `${log} estorno por segurança FALHOU: conferir na conciliação com o banco:`,
          erro
        );
      }
    }
  }
  motivo = motivo === null ? null : motivo.slice(0, LIMITE_MOTIVO);

  const alterados = await mudarStatus(pedidoId, [StatusPagamento.PENDENTE], {
    status,
    tentativas: resultado.tentativas,
    codigo_transacao: codigo,
    motivo,
  });

  if (alterados === 0) {
    // O pedido.cancelado chegou durante a cobrança (outra réplica marcou CANCELADO).
    const atual = await buscarPorPedido(pedidoId);
    if (atual?.status !== StatusPagamento.CANCELADO) {
      console.log(`${log} resultado da cobrança descartado: pagamento já ${atual?.status ?? "inexistente"}`);
      return;
    }
    if (codigo === null) {
      console.log(`${log} cancelado durante a cobrança e o banco não cobrou: nada a estornar`);
      return;
    }
    // Grava o código antes de estornar: se o estorno falhar, a reentrega sabe o que devolver.
    await mudarStatus(pedidoId, [StatusPagamento.CANCELADO], {
      status: StatusPagamento.CANCELADO,
      tentativas: resultado.tentativas,
      codigo_transacao: codigo,
    });
    await estornarERegistrar(pedidoId, codigo, valor, cliente, correlationId);
    return;
  }

  console.log(
    `${log} pagamento ${status} em ${resultado.tentativas} tentativa(s)${motivo ? `: ${motivo}` : ""}`
  );

  // Recusa do banco e banco fora dão no mesmo evento, com motivos diferentes: a saga compensa igual.
  if (codigo !== null) {
    await publicarAprovado(pedidoId, cliente, valor, codigo, resultado.tentativas, correlationId);
  } else {
    await publicarRecusado(
      pedidoId,
      cliente,
      valor,
      motivo ?? "pagamento recusado",
      resultado.tentativas,
      correlationId
    );
  }
};

// Aula 09, slide "PAGAMENTOS: AO RECEBER PEDIDO.CANCELADO": os dois lados da corrida num lugar só.
export const cancelarPagamentoService = async (
  evento: EnvelopeRecebido,
  dados: PedidoCanceladoDados
): Promise<void> => {
  const { pedidoId, correlationId } = evento;
  const log = logDe(correlationId, pedidoId);
  const cliente: Cliente = { usuarioId: dados.usuarioId, clienteEmail: dados.clienteEmail };

  // Ainda não cobrei? Ocupa o pedido_id com CANCELADO: a cobrança futura será ignorada.
  const gravou = await inserirSeNaoExiste({
    pedido_id: pedidoId,
    usuario_id: dados.usuarioId,
    valor: new Prisma.Decimal(dados.valorTotal).toDecimalPlaces(2),
    forma: null,
    cartao_final: null,
    status: StatusPagamento.CANCELADO,
    motivo: "pedido cancelado antes da cobrança",
  });
  if (gravou) {
    console.log(`${log} pedido.cancelado antes da cobrança: pagamento CANCELADO, o banco não será chamado`);
    return;
  }

  let pagamento = await buscarPorPedido(pedidoId);
  if (!pagamento) return;

  // Cobrança em andamento (outra réplica): marca CANCELADO; quem está cobrando estorna se aprovar.
  if (pagamento.status === StatusPagamento.PENDENTE) {
    const alterados = await mudarStatus(pedidoId, [StatusPagamento.PENDENTE], {
      status: StatusPagamento.CANCELADO,
      motivo: "pedido cancelado durante a cobrança",
    });
    if (alterados === 1) {
      console.log(`${log} pedido.cancelado durante a cobrança: CANCELADO (estorna se o banco aprovar)`);
      return;
    }
    pagamento = await buscarPorPedido(pedidoId);
    if (!pagamento) return;
  }

  // Já existe: só estorna o que foi cobrado. RECUSADO, ERRO e ESTORNADO não têm nada a devolver.
  const cobrado =
    pagamento.status === StatusPagamento.APROVADO ||
    (pagamento.status === StatusPagamento.CANCELADO && pagamento.codigo_transacao !== null);

  if (!cobrado || !pagamento.codigo_transacao) {
    console.log(`${log} pedido.cancelado: pagamento ${pagamento.status}, nada a estornar`);
    return;
  }

  await estornarERegistrar(
    pedidoId,
    pagamento.codigo_transacao,
    pagamento.valor.toNumber(),
    cliente,
    correlationId
  );
};

// GET /pagamentos/:pedidoId: dono ou admin. 404 (e não 403) para o de outra pessoa.
export const buscarPagamentoService = async (
  pedidoId: string,
  usuario: UsuarioIdentidade
): Promise<PagamentoView> => {
  const pagamento = !uuidSchema.safeParse(pedidoId).success
    ? null
    : usuario.perfil === "admin"
      ? await buscarPorPedido(pedidoId)
      : await buscarPorPedidoDoUsuario(pedidoId, usuario.id);

  if (!pagamento) {
    throw new NotFoundError("Pagamento não existe ou não é seu.");
  }
  return pagamento;
};

// GET /pagamentos: só admin. O Kong já barra o cliente (403); aqui é a segunda trava.
export const listarPagamentosService = async (
  usuario: UsuarioIdentidade
): Promise<PagamentoView[]> => {
  if (usuario.perfil !== "admin") {
    throw new ForbiddenError("Apenas administradores podem listar pagamentos.");
  }
  return listarTodos();
};
