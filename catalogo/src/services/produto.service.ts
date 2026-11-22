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
import { invalidarVitrine, lerOuBuscar, ResultadoCache } from "./cache.service.js";

export const listProdutosAtivosService = async (
  filters: ProdutoFilterOptions
): Promise<IProduto[]> => {
  return findActiveProdutos(filters);
};

// Vitrine (GET /produtos sem ids) com cache-aside. Os valores normalizados vão para a chave
// E para a consulta ao Mongo, para chave e resultado nunca divergirem.
export const listarVitrineService = async (filtros: {
  categoria?: string;
  busca?: string;
}): Promise<ResultadoCache> => {
  const categoria = filtros.categoria?.trim().toLowerCase() || undefined;
  const busca = filtros.busca?.trim().toLowerCase() || undefined;

  const sufixo =
    !categoria && !busca
      ? "produtos:todos"
      : `produtos:categoria=${encodeURIComponent(categoria ?? "")}&busca=${encodeURIComponent(busca ?? "")}`;

  return lerOuBuscar(sufixo, () => findActiveProdutos({ categoria, busca }));
};

// Busca em lote do checkout (?ids=): nunca passa pelo cache (o estoque é decidido no Mongo).
export const listarProdutosPorIdsService = async (ids: string[]): Promise<IProduto[]> => {
  return findActiveProdutos({ ids });
};

export const getProdutoCacheadoService = async (idOrSku: string): Promise<ResultadoCache> => {
  return lerOuBuscar(`produto:${encodeURIComponent(idOrSku)}`, () => getProdutoByIdService(idOrSku));
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

  const criado = await createProduto(data);
  await invalidarVitrine("produto criado");
  return criado;
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

  await invalidarVitrine("produto alterado");
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

  await invalidarVitrine("estoque ajustado");
  return updated;
};

export const desativarProdutoService = async (id: string): Promise<void> => {
  const updated = await softDeleteProdutoById(id);

  if (!updated) {
    throw new NotFoundError("Produto não encontrado.");
  }

  await invalidarVitrine("produto desativado");
};
