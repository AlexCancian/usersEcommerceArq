import { iniciarConsumer } from "../config/kafka.js";
import {
  confirmarReservaService,
  liberarReservaService,
  reservarEstoqueDoPedidoService,
} from "../services/reserva.service.js";
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

// Aula 09: confirmar e liberar só precisam do pedidoId do envelope (a reserva tem os itens).
// Leitor tolerante: os dados do evento não são lidos.

// groupId = nome do serviço: réplicas dividem as partições sozinhas.
// Um consumer só para os dois tópicos: pedidos (criado, cancelado) e pagamentos (aprovado, recusado).
export async function iniciarConsumerPedidos(): Promise<void> {
  await iniciarConsumer("catalogo", [TOPICOS.PEDIDOS, TOPICOS.PAGAMENTOS], {
    [TIPOS.PEDIDO_CRIADO]: aoCriarPedido,
    [TIPOS.PAGAMENTO_APROVADO]: confirmarReservaService, // reservado → vendido
    [TIPOS.PAGAMENTO_RECUSADO]: liberarReservaService, // COMPENSAÇÃO
    [TIPOS.PEDIDO_CANCELADO]: liberarReservaService, // COMPENSAÇÃO
  });
}
