import { iniciarConsumer } from "../config/kafka.js";
import { handlersPagamentos } from "./pagamentos.consumer.js";
import {
  cancelarPorEstoqueInsuficienteService,
  confirmarEstoqueReservadoService,
} from "../services/pedido.service.js";
import {
  EnvelopeRecebido,
  estoqueInsuficienteDadosSchema,
  estoqueReservadoDadosSchema,
  pedidoIdEventoSchema,
  TIPOS,
  TOPICOS,
} from "../utils/eventos.js";

// Validação antes do banco (D06): erro de validação = log + return (descarte);
// erro de infraestrutura (Prisma) sobe para o kafkajs reentregar.
function pedidoIdValido(evento: EnvelopeRecebido): boolean {
  const resultado = pedidoIdEventoSchema.safeParse(evento.pedidoId);
  if (!resultado.success) {
    console.error(
      `[correlationId=${evento.correlationId}] evento inválido descartado ${evento.tipo}: ${resultado.error.issues.map((i) => i.message).join("; ")}`
    );
  }
  return resultado.success;
}

async function aoReservar(evento: EnvelopeRecebido): Promise<void> {
  if (!pedidoIdValido(evento)) return;

  const dados = estoqueReservadoDadosSchema.safeParse(evento.dados);
  if (!dados.success) {
    console.error(
      `[correlationId=${evento.correlationId}] evento inválido descartado ${evento.tipo}: dados inválidos`
    );
    return;
  }

  await confirmarEstoqueReservadoService(evento.pedidoId, evento.correlationId);
}

async function aoFaltarEstoque(evento: EnvelopeRecebido): Promise<void> {
  if (!pedidoIdValido(evento)) return;

  const dados = estoqueInsuficienteDadosSchema.safeParse(evento.dados);
  if (!dados.success) {
    console.error(
      `[correlationId=${evento.correlationId}] evento inválido descartado ${evento.tipo}: ${dados.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
    );
    return;
  }

  await cancelarPorEstoqueInsuficienteService(
    evento.pedidoId,
    dados.data.motivo,
    evento.correlationId
  );
}

// groupId = nome do serviço: réplicas dividem as partições sozinhas.
// Aula 09: o mesmo consumer também escuta o tópico pagamentos (aprovado → PAGO, recusado → CANCELADO).
export async function iniciarConsumerEstoque(): Promise<void> {
  await iniciarConsumer("pedidos", [TOPICOS.ESTOQUE, TOPICOS.PAGAMENTOS], {
    [TIPOS.ESTOQUE_RESERVADO]: aoReservar,
    [TIPOS.ESTOQUE_INSUFICIENTE]: aoFaltarEstoque,
    ...handlersPagamentos,
  });
}
