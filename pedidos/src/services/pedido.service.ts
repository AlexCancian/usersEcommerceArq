import { randomUUID } from "node:crypto";
import { Prisma, StatusPedido } from "@prisma/client";
import { z } from "zod";
import { publicar } from "../config/kafka.js";
import { buscarProdutos } from "../catalogo.js";
import { listarItensDoCarrinho } from "../repositories/carrinho.repository.js";
import {
  buscarPedidoDoUsuario,
  cancelarPedidoDoUsuario,
  criarPedidoEEsvaziarCarrinho,
  listarPedidosDoUsuario,
  mudarStatusDoPedido,
  NovoItemPedido,
  PedidoComItens,
} from "../repositories/pedido.repository.js";
import { BadRequestError, ConflictError, NotFoundError } from "../utils/errors.js";
import { CheckoutDTO } from "../utils/schemas.js";
import { PedidoCriadoDados, TIPOS, TOPICOS } from "../utils/eventos.js";
import { UsuarioIdentidade } from "../middleware/auth.js";

// Status em que o pedido ainda pode ser cancelado
const STATUS_CANCELAVEIS: StatusPedido[] = [
  StatusPedido.AGUARDANDO_ESTOQUE,
  StatusPedido.AGUARDANDO_PAGAMENTO,
];

const uuidSchema = z.string().uuid();

// POST /pedidos: checkout. Pergunta ao catálogo o preço de cada produto na hora da compra.
// 202: o pedido foi aceito, mas ainda não terminou (fica em AGUARDANDO_ESTOQUE;
// quem o faz andar são os eventos: estoque.reservado ou estoque.insuficiente).
// Estoque não é checado aqui: quem decide é o catálogo, por evento (aula 08, D19).
export const checkoutService = async (
  usuario: UsuarioIdentidade,
  dados: CheckoutDTO,
  requestId?: string
): Promise<PedidoComItens> => {
  const correlationId = requestId ?? randomUUID(); // D05
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

  // COMMIT acontece aqui: a transação termina no retorno.
  const pedido = await criarPedidoEEsvaziarCarrinho({
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

  // Publica depois do commit: nunca anuncie um pedido que pode sumir num rollback.
  // Falha do Kafka não desfaz o pedido (D04): 202 mesmo assim e log para reprocesso manual.
  try {
    const dadosEvento = {
      usuarioId: usuario.id,
      clienteEmail: usuario.email,
      valorTotal: pedido.valor_total.toNumber(),
      formaPagamento: dados.forma_pagamento,
      cartaoFinal: pedido.cartao_final,
      itens: pedido.itens.map((i) => ({
        produtoId: i.produto_id,
        nomeProduto: i.nome_produto,
        precoUnitario: i.preco_unitario.toNumber(),
        quantidade: i.quantidade,
      })),
    } satisfies PedidoCriadoDados;

    await publicar(TOPICOS.PEDIDOS, TIPOS.PEDIDO_CRIADO, pedido.id, dadosEvento, correlationId);
  } catch (erro) {
    console.error(
      `[correlationId=${correlationId}] falha ao publicar pedido.criado pedidoId=${pedido.id} (pedido gravado, ficará em AGUARDANDO_ESTOQUE):`,
      erro
    );
  }

  return pedido;
};

// Reação a estoque.reservado: AGUARDANDO_ESTOQUE → AGUARDANDO_PAGAMENTO (filtro de estado, RN07).
export const confirmarEstoqueReservadoService = async (
  pedidoId: string,
  correlationId: string
): Promise<void> => {
  const alterados = await mudarStatusDoPedido(
    pedidoId,
    StatusPedido.AGUARDANDO_PAGAMENTO,
    [StatusPedido.AGUARDANDO_ESTOQUE]
  );

  if (alterados === 0) {
    console.log(
      `[correlationId=${correlationId}] estoque.reservado ignorado pedidoId=${pedidoId} (repetido ou status já mudou)`
    );
    return;
  }
  console.log(
    `[correlationId=${correlationId}] recebido estoque.reservado pedidoId=${pedidoId} → AGUARDANDO_PAGAMENTO`
  );
};

// Reação a estoque.insuficiente: AGUARDANDO_ESTOQUE → CANCELADO, com o motivo (RN07).
export const cancelarPorEstoqueInsuficienteService = async (
  pedidoId: string,
  motivo: string,
  correlationId: string
): Promise<void> => {
  const alterados = await mudarStatusDoPedido(
    pedidoId,
    StatusPedido.CANCELADO,
    [StatusPedido.AGUARDANDO_ESTOQUE],
    motivo
  );

  if (alterados === 0) {
    console.log(
      `[correlationId=${correlationId}] estoque.insuficiente ignorado pedidoId=${pedidoId} (repetido ou status já mudou)`
    );
    return;
  }
  console.log(
    `[correlationId=${correlationId}] recebido estoque.insuficiente pedidoId=${pedidoId} → CANCELADO`
  );
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
