import { Prisma, StatusPedido } from "@prisma/client";
import { z } from "zod";
import { buscarProdutos } from "../catalogo.js";
import { listarItensDoCarrinho } from "../repositories/carrinho.repository.js";
import {
  buscarPedidoDoUsuario,
  cancelarPedidoDoUsuario,
  criarPedidoEEsvaziarCarrinho,
  listarPedidosDoUsuario,
  NovoItemPedido,
  PedidoComItens,
} from "../repositories/pedido.repository.js";
import { BadRequestError, ConflictError, NotFoundError } from "../utils/errors.js";
import { CheckoutDTO } from "../utils/schemas.js";
import { UsuarioIdentidade } from "../middleware/auth.js";

// Status em que o pedido ainda pode ser cancelado
const STATUS_CANCELAVEIS: StatusPedido[] = [
  StatusPedido.AGUARDANDO_ESTOQUE,
  StatusPedido.AGUARDANDO_PAGAMENTO,
];

const uuidSchema = z.string().uuid();

// POST /pedidos: checkout. Pergunta ao catálogo o preço de cada produto na hora da compra.
// 202: o pedido foi aceito, mas ainda não terminou (fica em AGUARDANDO_ESTOQUE;
// na próxima aula, o Kafka o faz andar).
export const checkoutService = async (
  usuario: UsuarioIdentidade,
  dados: CheckoutDTO,
  requestId?: string
): Promise<PedidoComItens> => {
  const itensCarrinho = await listarItensDoCarrinho(usuario.id);

  if (itensCarrinho.length === 0) {
    throw new BadRequestError("Carrinho vazio.");
  }

  // Catálogo fora ou lento → CatalogoIndisponivelError → 503
  const produtos = await buscarProdutos(
    itensCarrinho.map((i) => i.produto_id),
    requestId
  );
  const porId = new Map(produtos.map((p) => [p._id, p]));

  const indisponiveis: string[] = [];
  const itensPedido: NovoItemPedido[] = [];
  let valorTotal = new Prisma.Decimal(0);

  for (const item of itensCarrinho) {
    const produto = porId.get(item.produto_id);

    if (!produto || !produto.ativo) {
      indisponiveis.push(`Produto ${item.produto_id} não está mais disponível.`);
      continue;
    }

    if (produto.estoque.disponivel < item.quantidade) {
      indisponiveis.push(
        `${produto.nome}: estoque insuficiente (disponível: ${produto.estoque.disponivel}).`
      );
      continue;
    }

    // Preço e nome copiados: histórico, não duplicação.
    const preco = new Prisma.Decimal(produto.preco).toDecimalPlaces(2);
    valorTotal = valorTotal.add(preco.mul(item.quantidade));
    itensPedido.push({
      produto_id: produto._id,
      nome_produto: produto.nome,
      preco_unitario: preco,
      quantidade: item.quantidade,
    });
  }

  if (indisponiveis.length > 0) {
    throw new ConflictError("Produto indisponível.", indisponiveis);
  }

  return criarPedidoEEsvaziarCarrinho({
    usuario_id: usuario.id,
    cliente_email: usuario.email,
    valor_total: valorTotal,
    endereco_entrega: { ...dados.endereco_entrega },
    forma_pagamento: dados.forma_pagamento,
    // Cartão: só os 4 últimos dígitos. O número inteiro nunca é gravado.
    cartao_final:
      dados.forma_pagamento === "cartao" && dados.numero_cartao
        ? dados.numero_cartao.slice(-4)
        : null,
    itens: itensPedido,
  });
};

export const listarPedidosService = async (usuarioId: string): Promise<PedidoComItens[]> => {
  return listarPedidosDoUsuario(usuarioId);
};

// 404 e não 403 no pedido de outra pessoa: um 403 confirmaria que o pedido existe.
export const buscarPedidoService = async (
  id: string,
  usuarioId: string
): Promise<PedidoComItens> => {
  const pedido = uuidSchema.safeParse(id).success
    ? await buscarPedidoDoUsuario(id, usuarioId)
    : null;

  if (!pedido) {
    throw new NotFoundError("Pedido não existe ou não é seu.");
  }

  return pedido;
};

// POST /pedidos/:id/cancelar: 200 cancelado · 409 status não permite
export const cancelarPedidoService = async (
  id: string,
  usuarioId: string
): Promise<PedidoComItens> => {
  const pedido = await buscarPedidoService(id, usuarioId);

  if (!STATUS_CANCELAVEIS.includes(pedido.status)) {
    throw new ConflictError(`Pedido com status ${pedido.status} não pode ser cancelado.`);
  }

  const alterados = await cancelarPedidoDoUsuario(id, usuarioId, STATUS_CANCELAVEIS);
  if (alterados === 0) {
    throw new ConflictError("O status do pedido mudou e ele não pode mais ser cancelado.");
  }

  return buscarPedidoService(id, usuarioId);
};
