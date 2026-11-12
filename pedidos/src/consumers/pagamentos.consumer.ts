import { HandlerEvento } from "../config/kafka.js";
import {
  cancelarPorPagamentoRecusadoService,
  confirmarPagamentoService,
} from "../services/pedido.service.js";
import {
  EnvelopeRecebido,
  pagamentoAprovadoDadosSchema,
  pagamentoRecusadoDadosSchema,
  pedidoIdEventoSchema,
  TIPOS,
} from "../utils/eventos.js";

// Aula 09: reações ao tópico pagamentos. Registradas no mesmo consumer do estoque
// (um consumer por serviço, groupId "pedidos"): ver iniciarConsumerEstoque.

function descartar(evento: EnvelopeRecebido, detalhes: string): void {
  console.error(
    `[correlationId=${evento.correlationId}] evento inválido descartado ${evento.tipo} pedidoId=${evento.pedidoId}: ${detalhes}`
  );
}

async function aoAprovarPagamento(evento: EnvelopeRecebido): Promise<void> {
  if (!pedidoIdEventoSchema.safeParse(evento.pedidoId).success) {
    return descartar(evento, "pedidoId deve ser um UUID.");
  }
  if (!pagamentoAprovadoDadosSchema.safeParse(evento.dados).success) {
    return descartar(evento, "dados inválidos");
  }
  await confirmarPagamentoService(evento.pedidoId, evento.correlationId);
}

async function aoRecusarPagamento(evento: EnvelopeRecebido): Promise<void> {
  if (!pedidoIdEventoSchema.safeParse(evento.pedidoId).success) {
    return descartar(evento, "pedidoId deve ser um UUID.");
  }
  const dados = pagamentoRecusadoDadosSchema.safeParse(evento.dados);
  if (!dados.success) {
    return descartar(
      evento,
      dados.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    );
  }
  await cancelarPorPagamentoRecusadoService(
    evento.pedidoId,
    dados.data.motivo,
    evento.correlationId
  );
}

export const handlersPagamentos: Record<string, HandlerEvento> = {
  [TIPOS.PAGAMENTO_APROVADO]: aoAprovarPagamento,
  [TIPOS.PAGAMENTO_RECUSADO]: aoRecusarPagamento,
};
