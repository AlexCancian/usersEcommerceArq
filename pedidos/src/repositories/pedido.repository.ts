import { Prisma, StatusPedido } from "@prisma/client";
import { prisma } from "../config/db.js";

const pedidoSelect = {
  id: true,
  cliente_email: true,
  status: true,
  valor_total: true,
  endereco_entrega: true,
  forma_pagamento: true,
  cartao_final: true,
  motivo_cancelamento: true,
  criado_em: true,
  itens: {
    select: {
      produto_id: true,
      nome_produto: true,
      preco_unitario: true,
      quantidade: true,
    },
    orderBy: { produto_id: "asc" },
  },
} satisfies Prisma.PedidoSelect;

export type PedidoComItens = Prisma.PedidoGetPayload<{ select: typeof pedidoSelect }>;

export interface NovoItemPedido {
  produto_id: string;
  nome_produto: string;
  preco_unitario: Prisma.Decimal;
  quantidade: number;
}

export interface NovoPedido {
  usuario_id: string;
  cliente_email: string;
  valor_total: Prisma.Decimal;
  endereco_entrega: Prisma.InputJsonObject;
  forma_pagamento: string;
  cartao_final: string | null;
  itens: NovoItemPedido[];
}

// Cria o pedido com os itens e esvazia o carrinho numa transação só:
// ou tudo acontece, ou nada acontece.
export const criarPedidoEEsvaziarCarrinho = async (
  dados: NovoPedido
): Promise<PedidoComItens> => {
  return prisma.$transaction(async (tx) => {
    const pedido = await tx.pedido.create({
      data: {
        usuario_id: dados.usuario_id,
        cliente_email: dados.cliente_email,
        valor_total: dados.valor_total,
        endereco_entrega: dados.endereco_entrega,
        forma_pagamento: dados.forma_pagamento,
        cartao_final: dados.cartao_final,
        itens: { createMany: { data: dados.itens } },
      },
      select: pedidoSelect,
    });

    await tx.carrinhoItem.deleteMany({ where: { usuario_id: dados.usuario_id } });

    return pedido;
  });
};

export const listarPedidosDoUsuario = async (usuarioId: string): Promise<PedidoComItens[]> => {
  return prisma.pedido.findMany({
    where: { usuario_id: usuarioId },
    select: pedidoSelect,
    orderBy: { criado_em: "desc" },
  });
};

// Busca filtrando também pelo dono: pedido de outra pessoa simplesmente "não existe".
export const buscarPedidoDoUsuario = async (
  id: string,
  usuarioId: string
): Promise<PedidoComItens | null> => {
  return prisma.pedido.findFirst({
    where: { id, usuario_id: usuarioId },
    select: pedidoSelect,
  });
};

// Filtro de estado (aula 08): só muda se o pedido ainda estiver num dos status de origem.
// Evento repetido ou atrasado devolve count 0 e não leva o pedido para trás.
export const mudarStatusDoPedido = async (
  id: string,
  novoStatus: StatusPedido,
  statusOrigem: StatusPedido[],
  motivo?: string
): Promise<number> => {
  const resultado = await prisma.pedido.updateMany({
    where: { id, status: { in: statusOrigem } },
    data: motivo === undefined
      ? { status: novoStatus }
      : { status: novoStatus, motivo_cancelamento: motivo },
  });
  return resultado.count;
};

// Atualização condicional: só cancela se o status ainda permitir no momento da escrita.
export const cancelarPedidoDoUsuario = async (
  id: string,
  usuarioId: string,
  statusPermitidos: StatusPedido[]
): Promise<number> => {
  const resultado = await prisma.pedido.updateMany({
    where: { id, usuario_id: usuarioId, status: { in: statusPermitidos } },
    data: { status: StatusPedido.CANCELADO },
  });
  return resultado.count;
};
