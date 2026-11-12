import mongoose from "mongoose";
import { Produto, IProduto } from "../models/produto.model.js";

export interface ProdutoFilterOptions {
  categoria?: string;
  busca?: string;
  ids?: string[];
}

export const findActiveProdutos = async (
  filters: ProdutoFilterOptions
): Promise<IProduto[]> => {
  const query: Record<string, unknown> = { ativo: true };

  if (filters.categoria) {
    query.categoria = filters.categoria.toLowerCase();
  }

  if (filters.busca) {
    query.nome = { $regex: filters.busca, $options: "i" };
  }

  // ?ids=a,b,c: uma consulta só para todos os produtos do carrinho (aula 07, slide 37)
  if (filters.ids && filters.ids.length > 0) {
    const objectIds = filters.ids.filter((id) => mongoose.Types.ObjectId.isValid(id));
    query.$or = [{ _id: { $in: objectIds } }, { sku: { $in: filters.ids } }];
  }

  return Produto.find(query).sort({ criado_em: -1 });
};

export const findProdutoByIdOrSku = async (
  idOrSku: string
): Promise<IProduto | null> => {
  if (mongoose.Types.ObjectId.isValid(idOrSku)) {
    const prod = await Produto.findById(idOrSku);
    if (prod) return prod;
  }
  return Produto.findOne({ sku: idOrSku });
};

export const findProdutoBySku = async (
  sku: string
): Promise<IProduto | null> => {
  return Produto.findOne({ sku });
};

export const createProduto = async (data: Partial<IProduto>): Promise<IProduto> => {
  return Produto.create(data);
};

export const updateProdutoById = async (
  id: string,
  data: Partial<IProduto>
): Promise<IProduto | null> => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return Produto.findOneAndUpdate({ sku: id }, data, { new: true });
  }
  return Produto.findByIdAndUpdate(id, data, { new: true });
};

export const updateEstoqueById = async (
  id: string,
  estoqueUpdate: { disponivel?: number; reservado?: number }
): Promise<IProduto | null> => {
  const updateQuery: Record<string, number> = {};

  if (estoqueUpdate.disponivel !== undefined) {
    updateQuery["estoque.disponivel"] = estoqueUpdate.disponivel;
  }
  if (estoqueUpdate.reservado !== undefined) {
    updateQuery["estoque.reservado"] = estoqueUpdate.reservado;
  }

  const filter = mongoose.Types.ObjectId.isValid(id)
    ? { _id: id }
    : { sku: id };

  return Produto.findOneAndUpdate(filter, { $set: updateQuery }, { new: true });
};

export const softDeleteProdutoById = async (
  id: string
): Promise<IProduto | null> => {
  const filter = mongoose.Types.ObjectId.isValid(id)
    ? { _id: id }
    : { sku: id };

  return Produto.findOneAndUpdate(filter, { ativo: false }, { new: true });
};

// ---- Aula 08: reserva de estoque por evento

// Só tira se houver: o $gte no filtro garante que dois pedidos ao mesmo tempo não
// deixam o estoque negativo. _id inválido vira "não reservou" (sem CastError em loop).
export const reservarEstoque = async (
  produtoId: string,
  quantidade: number
): Promise<boolean> => {
  if (!mongoose.Types.ObjectId.isValid(produtoId)) return false;

  const resultado = await Produto.updateOne(
    { _id: produtoId, "estoque.disponivel": { $gte: quantidade } },
    { $inc: { "estoque.disponivel": -quantidade, "estoque.reservado": quantidade } }
  );
  return resultado.modifiedCount === 1;
};

// Compensação: devolve só o que já foi reservado neste pedido.
export const devolverEstoque = async (
  produtoId: string,
  quantidade: number
): Promise<void> => {
  await Produto.updateOne(
    { _id: produtoId },
    { $inc: { "estoque.disponivel": quantidade, "estoque.reservado": -quantidade } }
  );
};

// Aula 09: pagamento aprovado. A unidade vendida sai do reservado (o disponível não muda).
export const confirmarSaidaDoEstoque = async (
  produtoId: string,
  quantidade: number
): Promise<void> => {
  await Produto.updateOne({ _id: produtoId }, { $inc: { "estoque.reservado": -quantidade } });
};

// Aula 09: compensação de uma reserva já confirmada (o reservado já tinha baixado): volta só ao disponível.
export const devolverAoDisponivel = async (
  produtoId: string,
  quantidade: number
): Promise<void> => {
  await Produto.updateOne({ _id: produtoId }, { $inc: { "estoque.disponivel": quantidade } });
};

// null: produto não existe (ou _id inválido). Usado só no caminho de falha, para o motivo.
export const buscarDisponivel = async (produtoId: string): Promise<number | null> => {
  if (!mongoose.Types.ObjectId.isValid(produtoId)) return null;

  const produto = await Produto.findById(produtoId).select("estoque.disponivel").lean();
  return produto ? produto.estoque.disponivel : null;
};
