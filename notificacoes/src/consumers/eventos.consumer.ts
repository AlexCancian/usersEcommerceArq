import { iniciarConsumer } from "../config/kafka.js";
import { ZodIssue, ZodType } from "zod";
import { logEvento } from "../utils/log.js";
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

// Só caminho e regra violada: nunca os dados do envelope (têm e-mail do cliente).
function descartar(evento: EnvelopeRecebido, issues: ZodIssue[]): void {
  logEvento("descartou", evento.tipo, evento.pedidoId, evento.correlationId, {
    motivo: issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
  });
}

// Dados inválidos = log + return (descarte, D06); erro de SMTP sobe para o retry.
async function aoCriarPedido(evento: EnvelopeRecebido): Promise<void> {
  const dados = pedidoCriadoDadosSchema.safeParse(evento.dados);
  if (!dados.success) {
    descartar(evento, dados.error.issues);
    return;
  }
  await avisarPedidoRecebidoService(evento, dados.data);
}

async function aoFaltarEstoque(evento: EnvelopeRecebido): Promise<void> {
  const dados = estoqueInsuficienteDadosSchema.safeParse(evento.dados);
  if (!dados.success) {
    descartar(evento, dados.error.issues);
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
      descartar(evento, dados.error.issues);
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
