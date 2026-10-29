import { Prisma } from "@prisma/client";
import { buscarProdutos, ProdutoCatalogo } from "../catalogo.js";
import {
  adicionarItemAoCarrinho,
  listarItensDoCarrinho,
  removerItemDoCarrinho,
  ItemCarrinho,
} from "../repositories/carrinho.repository.js";
import { CatalogoIndisponivelError, NotFoundError } from "../utils/errors.js";
import { AdicionarItemDTO } from "../utils/schemas.js";

export interface ItemCarrinhoDetalhado {
  produto_id: string;
  quantidade: number;
  nome: string | null;
  preco_unitario: string | null;
  subtotal: string | null;
  disponivel: boolean | null;
}

export interface CarrinhoResposta {
  itens: ItemCarrinhoDetalhado[];
  total: string | null;
  aviso?: string;
}

// GET /carrinho: { itens, total } com os preços ATUAIS do catálogo.
// Se o catálogo estiver fora, o carrinho continua funcionando, só que sem preços.
export const verCarrinhoService = async (
  usuarioId: string,
  requestId?: string
): Promise<CarrinhoResposta> => {
  const itens = await listarItensDoCarrinho(usuarioId);

  if (itens.length === 0) {
    return { itens: [], total: "0.00" };
  }

  let produtos: ProdutoCatalogo[];
  try {
    produtos = await buscarProdutos(itens.map((i) => i.produto_id), requestId);
  } catch (erro) {
    if (!(erro instanceof CatalogoIndisponivelError)) throw erro;
    return {
      itens: itens.map((i) => ({
        produto_id: i.produto_id,
        quantidade: i.quantidade,
        nome: null,
        preco_unitario: null,
        subtotal: null,
        disponivel: null,
      })),
      total: null,
      aviso: "Catálogo indisponível: preços não puderam ser atualizados.",
    };
  }

  const porId = new Map(produtos.map((p) => [p._id, p]));
  let total = new Prisma.Decimal(0);

  const detalhados = itens.map((i): ItemCarrinhoDetalhado => {
    const produto = porId.get(i.produto_id);
    if (!produto) {
      // Produto desativado ou removido do catálogo depois de entrar no carrinho
      return {
        produto_id: i.produto_id,
        quantidade: i.quantidade,
        nome: null,
        preco_unitario: null,
        subtotal: null,
        disponivel: false,
      };
    }

    const preco = new Prisma.Decimal(produto.preco).toDecimalPlaces(2);
    const subtotal = preco.mul(i.quantidade);
    total = total.add(subtotal);

    return {
      produto_id: i.produto_id,
      quantidade: i.quantidade,
      nome: produto.nome,
      preco_unitario: preco.toFixed(2),
      subtotal: subtotal.toFixed(2),
      disponivel: produto.estoque.disponivel >= i.quantidade,
    };
  });

  return { itens: detalhados, total: total.toFixed(2) };
};

// POST /carrinho/itens: confere no catálogo se o produto existe antes de guardar.
export const adicionarItemService = async (
  usuarioId: string,
  dados: AdicionarItemDTO,
  requestId?: string
): Promise<ItemCarrinho> => {
  const [produto] = await buscarProdutos([dados.produto_id], requestId);

  if (!produto) {
    throw new NotFoundError("Produto não existe.");
  }

  // Guarda sempre o _id do Mongo (mesmo se o cliente mandou o SKU)
  return adicionarItemAoCarrinho(usuarioId, produto._id, dados.quantidade);
};

export const removerItemService = async (usuarioId: string, produtoId: string): Promise<void> => {
  const removidos = await removerItemDoCarrinho(usuarioId, produtoId);

  if (removidos === 0) {
    throw new NotFoundError("Produto não está no carrinho.");
  }
};
