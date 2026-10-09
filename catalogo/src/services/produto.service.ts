import {
  findActiveProdutos,
  findProdutoByIdOrSku,
  findProdutoBySku,
  createProduto,
  updateProdutoById,
  updateEstoqueById,
  softDeleteProdutoById,
  ProdutoFilterOptions,
} from "../repositories/produto.repository.js";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../utils/errors.js";
import { IProduto } from "../models/produto.model.js";

export const listProdutosAtivosService = async (
  filters: ProdutoFilterOptions
): Promise<IProduto[]> => {
  return findActiveProdutos(filters);
};

export const getProdutoByIdService = async (
  idOrSku: string
): Promise<IProduto> => {
  const produto = await findProdutoByIdOrSku(idOrSku);

  if (!produto) {
    throw new NotFoundError("Produto não encontrado.");
  }

  return produto;
};

export const createProdutoService = async (
  data: Partial<IProduto>
): Promise<IProduto> => {
  if (data.sku) {
    const existingSku = await findProdutoBySku(data.sku);
    if (existingSku) {
      throw new ConflictError("Este SKU já está cadastrado.");
    }
  }

  return createProduto(data);
};

export const updateProdutoService = async (
  id: string,
  data: Partial<IProduto>
): Promise<IProduto> => {
  const existing = await findProdutoByIdOrSku(id);
  if (!existing) {
    throw new NotFoundError("Produto não encontrado.");
  }

  if (data.sku && data.sku !== existing.sku) {
    const skuConflict = await findProdutoBySku(data.sku);
    if (skuConflict) {
      throw new ConflictError("Este SKU já está cadastrado.");
    }
  }

  const updated = await updateProdutoById(id, data);
  if (!updated) {
    throw new NotFoundError("Produto não encontrado.");
  }

  return updated;
};

export const ajustarEstoqueService = async (
  id: string,
  estoque: { disponivel?: number; reservado?: number }
): Promise<IProduto> => {
  if (
    (estoque.disponivel !== undefined && estoque.disponivel < 0) ||
    (estoque.reservado !== undefined && estoque.reservado < 0)
  ) {
    throw new BadRequestError("Estoque não pode ser negativo.");
  }

  const updated = await updateEstoqueById(id, estoque);

  if (!updated) {
    throw new NotFoundError("Produto não encontrado.");
  }

  return updated;
};

export const desativarProdutoService = async (id: string): Promise<void> => {
  const updated = await softDeleteProdutoById(id);

  if (!updated) {
    throw new NotFoundError("Produto não encontrado.");
  }
};
