import { iniciarConsumer } from "../config/kafka.js";
import { reservarEstoqueDoPedidoService } from "../services/reserva.service.js";
import {
  EnvelopeRecebido,
  pedidoCriadoDadosSchema,
  TIPOS,
  TOPICOS,
} from "../utils/eventos.js";

// Dados inválidos = log + return (descarte, D06); erro de infraestrutura sobe para o retry.
async function aoCriarPedido(evento: EnvelopeRecebido): Promise<void> {
  const dados = pedidoCriadoDadosSchema.safeParse(evento.dados);
  if (!dados.success) {
    console.error(
      `[correlationId=${evento.correlationId}] evento inválido descartado ${evento.tipo} pedidoId=${evento.pedidoId}: ${dados.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
    );
    return;
  }

  await reservarEstoqueDoPedidoService(evento, dados.data);
}

// groupId = nome do serviço: réplicas dividem as partições sozinhas.
export async function iniciarConsumerPedidos(): Promise<void> {
  await iniciarConsumer("catalogo", [TOPICOS.PEDIDOS], {
    [TIPOS.PEDIDO_CRIADO]: aoCriarPedido,
  });
}
