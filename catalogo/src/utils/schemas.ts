import { z } from "zod";

export const createCategoriaSchema = z.object({
  body: z.object({
    nome: z
      .string({ required_error: "Nome é obrigatório." })
      .min(1, "Nome não pode ser vazio."),
    slug: z
      .string({ required_error: "Slug é obrigatório." })
      .min(1, "Slug não pode ser vazio.")
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug deve ser em letras minúsculas e separado por hífens."),
  }),
});

export const createProdutoSchema = z.object({
  body: z.object({
    sku: z
      .string({ required_error: "sku é obrigatório" })
      .min(1, "sku é obrigatório"),
    nome: z
      .string({ required_error: "nome é obrigatório" })
      .min(1, "nome é obrigatório"),
    categoria: z
      .string({ required_error: "categoria é obrigatória" })
      .min(1, "categoria é obrigatória"),
    preco: z
      .number({ required_error: "preco é obrigatório" })
      .positive("preco deve ser maior que zero"),
    ativo: z.boolean().optional().default(true),
    atributos: z.record(z.any()).optional().default({}),
    estoque: z.object({
      disponivel: z
        .number({ required_error: "disponivel é obrigatório" })
        .min(0, "estoque disponivel não pode ser negativo"),
      reservado: z
        .number()
        .min(0, "estoque reservado não pode ser negativo")
        .optional()
        .default(0),
    }),
  }),
});

export const updateProdutoSchema = z.object({
  body: z
    .object({
      sku: z.string().min(1).optional(),
      nome: z.string().min(1).optional(),
      categoria: z.string().min(1).optional(),
      preco: z.number().positive("preco deve ser maior que zero").optional(),
      ativo: z.boolean().optional(),
      atributos: z.record(z.any()).optional(),
      estoque: z
        .object({
          disponivel: z.number().min(0, "estoque disponivel não pode ser negativo").optional(),
          reservado: z.number().min(0, "estoque reservado não pode ser negativo").optional(),
        })
        .optional(),
    })
    .refine((data) => Object.keys(data).length > 0, {
      message: "Ao menos um campo deve ser fornecido para atualização.",
    }),
});

export const patchEstoqueSchema = z.object({
  body: z
    .object({
      disponivel: z
        .number({ invalid_type_error: "estoque deve ser um número" })
        .min(0, "estoque negativo")
        .optional(),
      reservado: z
        .number({ invalid_type_error: "estoque deve ser um número" })
        .min(0, "estoque negativo")
        .optional(),
    })
    .refine((data) => data.disponivel !== undefined || data.reservado !== undefined, {
      message: "Informe ao menos um valor de estoque (disponivel ou reservado).",
    }),
});

export const idParamSchema = z.object({
  params: z.object({
    id: z.string().min(1, "ID é obrigatório."),
  }),
});

export const queryProdutoSchema = z.object({
  query: z.object({
    categoria: z.string().optional(),
    busca: z.string().optional(),
    // Busca em lote usada pelo serviço pedidos: ?ids=a,b,c (ObjectId ou SKU)
    ids: z.string().min(1, "ids não pode ser vazio.").optional(),
  }),
});
