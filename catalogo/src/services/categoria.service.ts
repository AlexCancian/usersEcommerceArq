import {
  findAllCategorias,
  createCategoria,
  checkSlugExists,
} from "../repositories/categoria.repository.js";
import { ConflictError } from "../utils/errors.js";

export interface CreateCategoriaDTO {
  nome: string;
  slug: string;
}

export const listCategoriasService = async () => {
  return findAllCategorias();
};

export const createCategoriaService = async (data: CreateCategoriaDTO) => {
  const slugAlreadyExists = await checkSlugExists(data.slug);

  if (slugAlreadyExists) {
    throw new ConflictError("Este slug de categoria já está cadastrado.");
  }

  return createCategoria(data);
};
