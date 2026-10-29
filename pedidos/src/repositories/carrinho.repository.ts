import { prisma } from "../config/db.js";

export interface ItemCarrinho {
  produto_id: string;
  quantidade: number;
}

const itemSelect = {
  produto_id: true,
  quantidade: true,
} as const;

export const listarItensDoCarrinho = async (usuarioId: string): Promise<ItemCarrinho[]> => {
  return prisma.carrinhoItem.findMany({
    where: { usuario_id: usuarioId },
    select: itemSelect,
    orderBy: { produto_id: "asc" },
  });
};

// Produto já no carrinho: soma a quantidade. Senão, cria o item.
export const adicionarItemAoCarrinho = async (
  usuarioId: string,
  produtoId: string,
  quantidade: number
): Promise<ItemCarrinho> => {
  return prisma.carrinhoItem.upsert({
    where: {
      usuario_id_produto_id: { usuario_id: usuarioId, produto_id: produtoId },
    },
    create: { usuario_id: usuarioId, produto_id: produtoId, quantidade },
    update: { quantidade: { increment: quantidade } },
    select: itemSelect,
  });
};

// Retorna quantos itens foram removidos (0 = não estava no carrinho).
export const removerItemDoCarrinho = async (
  usuarioId: string,
  produtoId: string
): Promise<number> => {
  const resultado = await prisma.carrinhoItem.deleteMany({
    where: { usuario_id: usuarioId, produto_id: produtoId },
  });
  return resultado.count;
};
