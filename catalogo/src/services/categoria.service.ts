import {
  findAllCategorias,
  createCategoria,
  checkSlugExists,
} from "../repositories/categoria.repository.js";
import { ConflictError } from "../utils/errors.js";
import { invalidarVitrine, lerOuBuscar, ResultadoCache } from "./cache.service.js";

export interface CreateCategoriaDTO {
  nome: string;
  slug: string;
}

export const listCategoriasService = async (): Promise<ResultadoCache> => {
  return lerOuBuscar("categorias", findAllCategorias);
};

export const createCategoriaService = async (data: CreateCategoriaDTO) => {
  const slugAlreadyExists = await checkSlugExists(data.slug);

  if (slugAlreadyExists) {
    throw new ConflictError("Este slug de categoria já está cadastrado.");
  }

  const criada = await createCategoria(data);
  await invalidarVitrine("categoria criada");
  return criada;
};
