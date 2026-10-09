import { Categoria, ICategoria } from "../models/categoria.model.js";

export const findAllCategorias = async (): Promise<ICategoria[]> => {
  return Categoria.find().sort({ nome: 1 });
};

export const findCategoriaBySlug = async (
  slug: string
): Promise<ICategoria | null> => {
  return Categoria.findOne({ slug: slug.toLowerCase() });
};

export const createCategoria = async (data: {
  nome: string;
  slug: string;
}): Promise<ICategoria> => {
  return Categoria.create({
    nome: data.nome,
    slug: data.slug.toLowerCase(),
  });
};

export const checkSlugExists = async (slug: string): Promise<boolean> => {
  const exists = await Categoria.exists({ slug: slug.toLowerCase() });
  return Boolean(exists);
};
