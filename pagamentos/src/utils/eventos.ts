import { z } from "zod";

// Quem sobe primeiro cria os tópicos (garantirTopicos): por isso a lista inclui os que só consumo.
export const TOPICOS = {
  PEDIDOS: "pedidos",
  ESTOQUE: "estoque",
  PAGAMENTOS: "pagamentos",
} as const;
export type Topico = (typeof TOPICOS)[keyof typeof TOPICOS];

export const TIPOS = {
  ESTOQUE_RESERVADO: "estoque.reservado",
  PEDIDO_CANCELADO: "pedido.cancelado",
  PAGAMENTO_APROVADO: "pagamento.aprovado",
  PAGAMENTO_RECUSADO: "pagamento.recusado",
  PAGAMENTO_ESTORNADO: "pagamento.estornado",
} as const;

// Envelope publicado (aula 08, slide "O ENVELOPE")
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

// pedido_id é UUID no banco: validar antes do Prisma evita erro em loop na reentrega.
export const pedidoIdEventoSchema = z.string().uuid("pedidoId deve ser um UUID.");

// ---- Consumido: estoque.reservado (tudo que a cobrança precisa vem no evento: aula 09)
export const estoqueReservadoDadosSchema = z.object({
  usuarioId: z.string().uuid("usuarioId deve ser um UUID."),
  clienteEmail: z.string().email("clienteEmail inválido."),
  valorTotal: z.number().nonnegative("valorTotal não pode ser negativo."),
  formaPagamento: z.string().min(1, "formaPagamento é obrigatória."),
  // Eventos antigos (antes da aula 09) não tinham cartaoFinal
  cartaoFinal: z.string().regex(/^\d{4}$/, "cartaoFinal deve ter 4 dígitos.").nullable().optional(),
});
export type EstoqueReservadoDados = z.infer<typeof estoqueReservadoDadosSchema>;

// ---- Consumido: pedido.cancelado (cancelamento pelo cliente)
export const pedidoCanceladoDadosSchema = z.object({
  usuarioId: z.string().uuid("usuarioId deve ser um UUID."),
  clienteEmail: z.string().email("clienteEmail inválido."),
  valorTotal: z.number().nonnegative("valorTotal não pode ser negativo."),
});
export type PedidoCanceladoDados = z.infer<typeof pedidoCanceladoDadosSchema>;

// ---- Produzidos (tópico pagamentos)
export interface PagamentoAprovadoDados {
  usuarioId: string;
  clienteEmail: string;
  valor: number;
  codigoTransacao: string;
  tentativas: number;
}

export interface PagamentoRecusadoDados {
  usuarioId: string;
  clienteEmail: string;
  valor: number;
  motivo: string;
  tentativas: number;
}

export interface PagamentoEstornadoDados {
  usuarioId: string;
  clienteEmail: string;
  valor: number;
  codigoTransacao: string;
}
