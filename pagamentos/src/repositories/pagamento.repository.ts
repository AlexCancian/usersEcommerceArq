import { Prisma, StatusPagamento } from "@prisma/client";
import { prisma } from "../config/db.js";

const pagamentoSelect = {
  id: true,
  pedido_id: true,
  usuario_id: true,
  valor: true,
  forma: true,
  cartao_final: true,
  status: true,
  tentativas: true,
  codigo_transacao: true,
  motivo: true,
  criado_em: true,
} satisfies Prisma.PagamentoSelect;

export type PagamentoView = Prisma.PagamentoGetPayload<{ select: typeof pagamentoSelect }>;

export interface NovoPagamento {
  pedido_id: string;
  usuario_id: string;
  valor: Prisma.Decimal;
  forma: string | null;
  cartao_final: string | null;
  status: StatusPagamento;
  motivo?: string;
}

// Equivale ao INSERT ... ON CONFLICT (pedido_id) DO NOTHING da aula.
// true: gravou (primeira vez). false: o pedido_id já estava ocupado.
export const inserirSeNaoExiste = async (dados: NovoPagamento): Promise<boolean> => {
  const resultado = await prisma.pagamento.createMany({
    data: [dados],
    skipDuplicates: true,
  });
  return resultado.count === 1;
};

export const buscarPorPedido = async (pedidoId: string): Promise<PagamentoView | null> => {
  return prisma.pagamento.findUnique({
    where: { pedido_id: pedidoId },
    select: pagamentoSelect,
  });
};

// Filtrando pelo dono: pagamento de outra pessoa simplesmente "não existe" (404).
export const buscarPorPedidoDoUsuario = async (
  pedidoId: string,
  usuarioId: string
): Promise<PagamentoView | null> => {
  return prisma.pagamento.findFirst({
    where: { pedido_id: pedidoId, usuario_id: usuarioId },
    select: pagamentoSelect,
  });
};

export const listarTodos = async (): Promise<PagamentoView[]> => {
  return prisma.pagamento.findMany({
    select: pagamentoSelect,
    orderBy: { criado_em: "desc" },
  });
};

// Update condicional: só muda a partir dos status esperados. count 0 = alguém mudou antes.
export const mudarStatus = async (
  pedidoId: string,
  statusOrigem: StatusPagamento[],
  dados: {
    status: StatusPagamento;
    tentativas?: number;
    codigo_transacao?: string | null;
    motivo?: string | null;
  }
): Promise<number> => {
  const resultado = await prisma.pagamento.updateMany({
    where: { pedido_id: pedidoId, status: { in: statusOrigem } },
    data: dados,
  });
  return resultado.count;
};
