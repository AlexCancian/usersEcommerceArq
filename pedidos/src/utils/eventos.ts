import { z } from "zod";

export const TOPICOS = {
  PEDIDOS: "pedidos",
  ESTOQUE: "estoque",
} as const;
export type Topico = (typeof TOPICOS)[keyof typeof TOPICOS];

export const TIPOS = {
  PEDIDO_CRIADO: "pedido.criado",
  ESTOQUE_RESERVADO: "estoque.reservado",
  ESTOQUE_INSUFICIENTE: "estoque.insuficiente",
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

// Envelope recebido: dados ainda desconhecidos até olhar o tipo
export const envelopeRecebidoSchema = z.object({
  id: z.string().uuid("id do evento deve ser um UUID."),
  tipo: z.string().min(1, "tipo é obrigatório."),
  pedidoId: z.string().min(1, "pedidoId é obrigatório."),
  ocorridoEm: z.string().datetime({ message: "ocorridoEm deve ser ISO 8601 UTC." }),
  correlationId: z.string().min(1, "correlationId é obrigatório."),
  dados: z.unknown(),
});
export type EnvelopeRecebido = z.infer<typeof envelopeRecebidoSchema>;

// ---- Produzido: pedido.criado
export const itemEventoSchema = z.object({
  produtoId: z.string().min(1),
  nomeProduto: z.string().min(1),
  precoUnitario: z.number().nonnegative(),
  quantidade: z.number().int().positive(),
});
export type ItemEvento = z.infer<typeof itemEventoSchema>;

export const pedidoCriadoDadosSchema = z.object({
  usuarioId: z.string().uuid(),
  clienteEmail: z.string().email(),
  valorTotal: z.number().nonnegative(),
  formaPagamento: z.enum(["cartao", "pix", "boleto"]),
  cartaoFinal: z.string().regex(/^\d{4}$/).nullable(),
  itens: z.array(itemEventoSchema).min(1),
});
export type PedidoCriadoDados = z.infer<typeof pedidoCriadoDadosSchema>;

// ---- Consumido: estoque.* (pedidos só usa o pedidoId e o motivo — leitor tolerante)
// pedidoId vira filtro numa coluna UUID: validar antes do Prisma evita P2023 em loop.
export const pedidoIdEventoSchema = z.string().uuid("pedidoId deve ser um UUID.");

export const estoqueReservadoDadosSchema = z.object({});
export type EstoqueReservadoDados = z.infer<typeof estoqueReservadoDadosSchema>;

export const estoqueInsuficienteDadosSchema = z.object({
  motivo: z.string().min(1, "motivo é obrigatório.").max(500, "motivo deve ter no máximo 500 caracteres."),
});
export type EstoqueInsuficienteDados = z.infer<typeof estoqueInsuficienteDadosSchema>;
