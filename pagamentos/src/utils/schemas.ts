import { z } from "zod";

export const pedidoIdParamSchema = z.object({
  params: z.object({
    pedidoId: z.string().min(1, "pedidoId é obrigatório."),
  }),
});
