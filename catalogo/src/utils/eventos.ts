import { z } from "zod";

export const TOPICOS = {
  PEDIDOS: "pedidos",
  ESTOQUE: "estoque",
  PAGAMENTOS: "pagamentos",
} as const;
export type Topico = (typeof TOPICOS)[keyof typeof TOPICOS];

export const TIPOS = {
  PEDIDO_CRIADO: "pedido.criado",
  ESTOQUE_RESERVADO: "estoque.reservado",
  ESTOQUE_INSUFICIENTE: "estoque.insuficiente",
  // Aula 09: a saga (compensações)
  PEDIDO_CANCELADO: "pedido.cancelado",
  PAGAMENTO_APROVADO: "pagamento.aprovado",
  PAGAMENTO_RECUSADO: "pagamento.recusado",
} as const;

export interface Envelope<TDados> {
  id: string;
  tipo: string;
  pedidoId: string;
  ocorridoEm: string;
  correlationId: string;
  dados: TDados;
}

export const envelopeRecebidoSchema = z.object({
  id: z.string().uuid("id do evento deve ser um UUID."),
  tipo: z.string().min(1, "tipo é obrigatório."),
  pedidoId: z.string().min(1, "pedidoId é obrigatório."),
  ocorridoEm: z.string().datetime({ message: "ocorridoEm deve ser ISO 8601 UTC." }),
  correlationId: z.string().min(1, "correlationId é obrigatório."),
  dados: z.unknown(),
});
export type EnvelopeRecebido = z.infer<typeof envelopeRecebidoSchema>;

// Itens: o catálogo usa produtoId/quantidade e repassa nomeProduto/precoUnitario no estoque.reservado
export const itemEventoSchema = z.object({
  produtoId: z.string().min(1, "produtoId é obrigatório."),
  nomeProduto: z.string().min(1, "nomeProduto é obrigatório."),
  precoUnitario: z.number().nonnegative("precoUnitario não pode ser negativo."),
  quantidade: z.number().int("quantidade deve ser inteira.").positive("quantidade deve ser maior que zero."),
});
export type ItemEvento = z.infer<typeof itemEventoSchema>;

// ---- Consumido: pedido.criado (aula 09: cartaoFinal é repassado no estoque.reservado para o pagamentos)
export const pedidoCriadoDadosSchema = z.object({
  usuarioId: z.string().min(1, "usuarioId é obrigatório."),
  clienteEmail: z.string().email("clienteEmail inválido."),
  valorTotal: z.number().nonnegative("valorTotal não pode ser negativo."),
  formaPagamento: z.string().min(1, "formaPagamento é obrigatória."),
  cartaoFinal: z.string().regex(/^\d{4}$/, "cartaoFinal deve ter 4 dígitos.").nullable().optional(),
  itens: z.array(itemEventoSchema).min(1, "itens não pode ser vazio."),
});
export type PedidoCriadoDados = z.infer<typeof pedidoCriadoDadosSchema>;

// ---- Produzidos
export interface EstoqueReservadoDados {
  usuarioId: string;
  clienteEmail: string;
  itens: ItemEvento[];
  valorTotal: number;
  formaPagamento: string;
  cartaoFinal: string | null; // aula 09: tudo que a cobrança precisa vem no evento
}

export interface EstoqueInsuficienteDados {
  motivo: string;
  usuarioId: string;
  clienteEmail: string;
}
