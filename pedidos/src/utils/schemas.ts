import { z } from "zod";

export const adicionarItemSchema = z.object({
  body: z.object({
    produto_id: z
      .string({ required_error: "produto_id é obrigatório." })
      .min(1, "produto_id é obrigatório."),
    quantidade: z
      .number({
        required_error: "quantidade é obrigatória.",
        invalid_type_error: "quantidade deve ser um número.",
      })
      .int("quantidade deve ser um número inteiro.")
      .positive("quantidade deve ser maior que zero."),
  }),
});

export const produtoIdParamSchema = z.object({
  params: z.object({
    produtoId: z.string().min(1, "produtoId é obrigatório."),
  }),
});

export const pedidoIdParamSchema = z.object({
  params: z.object({
    id: z.string().min(1, "ID do pedido é obrigatório."),
  }),
});

const enderecoEntregaSchema = z.object({
  cep: z
    .string({ required_error: "CEP é obrigatório." })
    .min(1, "CEP é obrigatório."),
  logradouro: z
    .string({ required_error: "Logradouro é obrigatório." })
    .min(1, "Logradouro é obrigatório."),
  numero: z.string().optional(),
  complemento: z.string().optional(),
  cidade: z
    .string({ required_error: "Cidade é obrigatória." })
    .min(1, "Cidade é obrigatória."),
  uf: z
    .string({ required_error: "UF é obrigatória." })
    .length(2, "UF deve ter exatamente 2 caracteres."),
});

export const checkoutSchema = z.object({
  body: z
    .object({
      endereco_entrega: enderecoEntregaSchema,
      forma_pagamento: z.enum(["cartao", "pix", "boleto"], {
        required_error: "forma_pagamento é obrigatória.",
        invalid_type_error: "forma_pagamento deve ser cartao, pix ou boleto.",
      }),
      // O número completo só passa pela memória: no banco fica apenas cartao_final (4 dígitos).
      numero_cartao: z
        .string()
        .regex(/^\d{13,19}$/, "numero_cartao deve ter de 13 a 19 dígitos.")
        .optional(),
    })
    .refine((dados) => dados.forma_pagamento !== "cartao" || dados.numero_cartao !== undefined, {
      message: "numero_cartao é obrigatório quando forma_pagamento é cartao.",
    }),
});

export type AdicionarItemDTO = z.infer<typeof adicionarItemSchema>["body"];
export type CheckoutDTO = z.infer<typeof checkoutSchema>["body"];
