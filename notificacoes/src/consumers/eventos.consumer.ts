import { iniciarConsumer } from "../config/kafka.js";
import { ZodType } from "zod";
import {
  avisarPagamentoAprovadoService,
  avisarPagamentoEstornadoService,
  avisarPagamentoRecusadoService,
  avisarPedidoRecebidoService,
  avisarSemEstoqueService,
} from "../services/notificacao.service.js";
import {
  EnvelopeRecebido,
  estoqueInsuficienteDadosSchema,
  pagamentoAprovadoDadosSchema,
  pagamentoEstornadoDadosSchema,
  pagamentoRecusadoDadosSchema,
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

// Aula 09: valida os dados com o schema do tipo e chama o envio (dados inválidos = descarte, D06).
function comSchema<T>(
  schema: ZodType<T>,
  avisar: (evento: EnvelopeRecebido, dados: T) => Promise<void>
): (evento: EnvelopeRecebido) => Promise<void> {
  return async (evento) => {
    const dados = schema.safeParse(evento.dados);
    if (!dados.success) {
      console.error(
        `[correlationId=${evento.correlationId}] evento inválido descartado ${evento.tipo} pedidoId=${evento.pedidoId}: ${dados.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
      );
      return;
    }
    await avisar(evento, dados.data);
  };
}

// estoque.reservado, pedido.cancelado e outros tipos: sem handler, o consumer ignora (RN13).
export async function iniciarConsumerEventos(): Promise<void> {
  await iniciarConsumer("notificacoes", [TOPICOS.PEDIDOS, TOPICOS.ESTOQUE, TOPICOS.PAGAMENTOS], {
    [TIPOS.PEDIDO_CRIADO]: aoCriarPedido,
    [TIPOS.ESTOQUE_INSUFICIENTE]: aoFaltarEstoque,
    [TIPOS.PAGAMENTO_APROVADO]: comSchema(pagamentoAprovadoDadosSchema, avisarPagamentoAprovadoService),
    [TIPOS.PAGAMENTO_RECUSADO]: comSchema(pagamentoRecusadoDadosSchema, avisarPagamentoRecusadoService),
    [TIPOS.PAGAMENTO_ESTORNADO]: comSchema(pagamentoEstornadoDadosSchema, avisarPagamentoEstornadoService),
  });
}
