import mongoose from "mongoose";
import { Produto, IProduto } from "../models/produto.model.js";

export interface ProdutoFilterOptions {
  categoria?: string;
  busca?: string;
}

export const findActiveProdutos = async (
  filters: ProdutoFilterOptions
): Promise<IProduto[]> => {
  const query: Record<string, any> = { ativo: true };

  if (filters.categoria) {
    query.categoria = filters.categoria.toLowerCase();
  }

  if (filters.busca) {
    query.nome = { $regex: filters.busca, $options: "i" };
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
  const updateQuery: Record<string, any> = {};

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
