import { z } from "zod";

export const cobrancaSchema = z.object({
  body: z.object({
    valor: z
      .number({ required_error: "valor é obrigatório.", invalid_type_error: "valor deve ser um número." })
      .positive("valor deve ser maior que zero."),
    // pix e boleto não têm cartão
    cartaoFinal: z
      .string()
      .regex(/^\d{4}$/, "cartaoFinal deve ter 4 dígitos.")
      .nullable()
      .optional(),
    // Chave de idempotência: o id do pedido (aula 09, slide "CHAVE DE IDEMPOTÊNCIA")
    referencia: z
      .string({ required_error: "referencia é obrigatória." })
      .min(1, "referencia é obrigatória."),
  }),
});

export const estornoSchema = z.object({
  body: z
    .object({
      codigo: z.string().min(1, "codigo não pode ser vazio.").nullable().optional(),
      referencia: z.string().min(1, "referencia não pode ser vazia.").optional(),
    })
    .refine((d) => Boolean(d.codigo) || Boolean(d.referencia), {
      message: "Informe codigo ou referencia.",
    }),
});

export const configSchema = z.object({
  body: z.object({
    latenciaMs: z
      .number({ invalid_type_error: "latenciaMs deve ser um número." })
      .int("latenciaMs deve ser inteiro.")
      .min(0, "latenciaMs não pode ser negativo.")
      .max(60000, "latenciaMs deve ser no máximo 60000.")
      .optional(),
    falhaPercent: z
      .number({ invalid_type_error: "falhaPercent deve ser um número." })
      .int("falhaPercent deve ser inteiro.")
      .min(0, "falhaPercent deve ser entre 0 e 100.")
      .max(100, "falhaPercent deve ser entre 0 e 100.")
      .optional(),
  }),
});

export type CobrancaDTO = z.infer<typeof cobrancaSchema>["body"];
export type EstornoDTO = z.infer<typeof estornoSchema>["body"];
export type ConfigDTO = z.infer<typeof configSchema>["body"];
