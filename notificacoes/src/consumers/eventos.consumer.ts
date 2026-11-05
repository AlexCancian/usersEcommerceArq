import { iniciarConsumer } from "../config/kafka.js";
import {
  avisarPedidoRecebidoService,
  avisarSemEstoqueService,
} from "../services/notificacao.service.js";
import {
  EnvelopeRecebido,
  estoqueInsuficienteDadosSchema,
  pedidoCriadoDadosSchema,
  TIPOS,
  TOPICOS,
} from "../utils/eventos.js";

// Dados inválidos = log + return (descarte, D06); erro de SMTP sobe para o retry.
async function aoCriarPedido(evento: EnvelopeRecebido): Promise<void> {
  const dados = pedidoCriadoDadosSchema.safeParse(evento.dados);
  if (!dados.success) {
    console.error(
      `[correlationId=${evento.correlationId}] evento inválido descartado ${evento.tipo} pedidoId=${evento.pedidoId}: ${dados.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
    );
    return;
  }
  await avisarPedidoRecebidoService(evento, dados.data);
}

async function aoFaltarEstoque(evento: EnvelopeRecebido): Promise<void> {
  const dados = estoqueInsuficienteDadosSchema.safeParse(evento.dados);
  if (!dados.success) {
    console.error(
      `[correlationId=${evento.correlationId}] evento inválido descartado ${evento.tipo} pedidoId=${evento.pedidoId}: ${dados.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
    );
    return;
  }
  await avisarSemEstoqueService(evento, dados.data);
}

// estoque.reservado e outros tipos: sem handler, o consumer ignora (RN13).
export async function iniciarConsumerEventos(): Promise<void> {
  await iniciarConsumer("notificacoes", [TOPICOS.PEDIDOS, TOPICOS.ESTOQUE], {
    [TIPOS.PEDIDO_CRIADO]: aoCriarPedido,
    [TIPOS.ESTOQUE_INSUFICIENTE]: aoFaltarEstoque,
  });
}
