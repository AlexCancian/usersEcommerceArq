import { z } from "zod";

export const TOPICOS = {
  PEDIDOS: "pedidos",
  ESTOQUE: "estoque",
} as const;
export type Topico = (typeof TOPICOS)[keyof typeof TOPICOS];

export const TIPOS = {
  PEDIDO_CRIADO: "pedido.criado",
  ESTOQUE_INSUFICIENTE: "estoque.insuficiente",
} as const;

export const envelopeRecebidoSchema = z.object({
  id: z.string().uuid("id do evento deve ser um UUID."),
  tipo: z.string().min(1, "tipo é obrigatório."),
  pedidoId: z.string().min(1, "pedidoId é obrigatório."),
  ocorridoEm: z.string().datetime({ message: "ocorridoEm deve ser ISO 8601 UTC." }),
  correlationId: z.string().min(1, "correlationId é obrigatório."),
  dados: z.unknown(),
});
export type EnvelopeRecebido = z.infer<typeof envelopeRecebidoSchema>;

// Só o que o e-mail usa (leitor tolerante)
export const itemEmailSchema = z.object({
  nomeProduto: z.string().min(1),
  quantidade: z.number().int().positive(),
});

export const pedidoCriadoDadosSchema = z.object({
  clienteEmail: z.string().email("clienteEmail inválido."),
  valorTotal: z.number().nonnegative("valorTotal não pode ser negativo."),
  itens: z.array(itemEmailSchema).min(1, "itens não pode ser vazio."),
});
export type PedidoCriadoDados = z.infer<typeof pedidoCriadoDadosSchema>;

export const estoqueInsuficienteDadosSchema = z.object({
  clienteEmail: z.string().email("clienteEmail inválido."),
  motivo: z.string().min(1, "motivo é obrigatório."),
});
export type EstoqueInsuficienteDados = z.infer<typeof estoqueInsuficienteDadosSchema>;
