import { iniciarConsumer } from "../config/kafka.js";
import {
  cancelarPagamentoService,
  processarEstoqueReservadoService,
} from "../services/pagamento.service.js";
import {
  EnvelopeRecebido,
  estoqueReservadoDadosSchema,
  pedidoCanceladoDadosSchema,
  pedidoIdEventoSchema,
  TIPOS,
  TOPICOS,
} from "../utils/eventos.js";

// Dados inválidos = log + return (descarte, D06 da aula 08); erro de infraestrutura
// (banco, Kafka, estorno que não conseguiu) sobe para o kafkajs reentregar.
function invalido(evento: EnvelopeRecebido, detalhes: string): void {
  console.error(
    `[correlationId=${evento.correlationId}] evento inválido descartado ${evento.tipo} pedidoId=${evento.pedidoId}: ${detalhes}`
  );
}

async function aoReservarEstoque(evento: EnvelopeRecebido): Promise<void> {
  if (!pedidoIdEventoSchema.safeParse(evento.pedidoId).success) {
    return invalido(evento, "pedidoId deve ser um UUID.");
  }
  const dados = estoqueReservadoDadosSchema.safeParse(evento.dados);
  if (!dados.success) {
    return invalido(
      evento,
      dados.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    );
  }
  await processarEstoqueReservadoService(evento, dados.data);
}

async function aoCancelarPedido(evento: EnvelopeRecebido): Promise<void> {
  if (!pedidoIdEventoSchema.safeParse(evento.pedidoId).success) {
    return invalido(evento, "pedidoId deve ser um UUID.");
  }
  const dados = pedidoCanceladoDadosSchema.safeParse(evento.dados);
  if (!dados.success) {
    return invalido(
      evento,
      dados.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    );
  }
  await cancelarPagamentoService(evento, dados.data);
}

// Escuta o tópico estoque (não o pedidos) para cobrar: só cobra o que já tem estoque reservado.
// Do tópico pedidos, só o pedido.cancelado. groupId = nome do serviço.
export async function iniciarConsumerEventos(): Promise<void> {
  await iniciarConsumer("pagamentos", [TOPICOS.ESTOQUE, TOPICOS.PEDIDOS], {
    [TIPOS.ESTOQUE_RESERVADO]: aoReservarEstoque,
    [TIPOS.PEDIDO_CANCELADO]: aoCancelarPedido,
  });
}
