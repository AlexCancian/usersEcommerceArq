import { env } from "../config/env.js";
import { smtp } from "../config/smtp.js";
import {
  EnvelopeRecebido,
  EstoqueInsuficienteDados,
  PagamentoAprovadoDados,
  PagamentoEstornadoDados,
  PagamentoRecusadoDados,
  PedidoCriadoDados,
} from "../utils/eventos.js";

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

// Erro de SMTP sobe (throw): o kafkajs reentrega. E-mail duplicado em reentrega é aceito (D14).
async function enviar(
  evento: EnvelopeRecebido,
  para: string,
  assunto: string,
  texto: string
): Promise<void> {
  await smtp.sendMail({ from: env.MAIL_FROM, to: para, subject: assunto, text: texto });
  console.log(
    `[correlationId=${evento.correlationId}] e-mail "${assunto}" enviado pedidoId=${evento.pedidoId}`
  );
}

export const avisarPedidoRecebidoService = async (
  evento: EnvelopeRecebido,
  dados: PedidoCriadoDados
): Promise<void> => {
  const itens = dados.itens.map((i) => `- ${i.quantidade}x ${i.nomeProduto}`).join("\n");
  const texto =
    `Olá! Recebemos o seu pedido ${evento.pedidoId}.\n\n` +
    `Itens:\n${itens}\n\n` +
    `Total: ${moeda.format(dados.valorTotal)}\n\n` +
    `Avisaremos quando o pagamento for confirmado.`;

  await enviar(evento, dados.clienteEmail, "Recebemos o seu pedido", texto);
};

export const avisarSemEstoqueService = async (
  evento: EnvelopeRecebido,
  dados: EstoqueInsuficienteDados
): Promise<void> => {
  const texto =
    `Olá! Infelizmente o pedido ${evento.pedidoId} foi cancelado.\n\n` +
    `Motivo: ${dados.motivo}\n\n` +
    `Nenhum valor foi cobrado.`;

  await enviar(
    evento,
    dados.clienteEmail,
    "Seu pedido foi cancelado: produto sem estoque",
    texto
  );
};

// ---- Aula 09: e-mails da saga. O "pedido confirmado" só sai depois do pagamento aprovado.

export const avisarPagamentoAprovadoService = async (
  evento: EnvelopeRecebido,
  dados: PagamentoAprovadoDados
): Promise<void> => {
  const texto =
    `Olá! O pagamento do pedido ${evento.pedidoId} foi aprovado.\n\n` +
    `Valor: ${moeda.format(dados.valor)}\n` +
    `Transação: ${dados.codigoTransacao}\n\n` +
    `Seu pedido está confirmado.`;

  await enviar(evento, dados.clienteEmail, "Pagamento aprovado: pedido confirmado", texto);
};

export const avisarPagamentoRecusadoService = async (
  evento: EnvelopeRecebido,
  dados: PagamentoRecusadoDados
): Promise<void> => {
  const texto =
    `Olá! O pagamento do pedido ${evento.pedidoId} não foi aprovado e o pedido foi cancelado.\n\n` +
    `Motivo: ${dados.motivo}\n\n` +
    `Nenhum valor foi cobrado. Você pode tentar a compra de novo.`;

  await enviar(evento, dados.clienteEmail, "Pagamento recusado: pedido cancelado", texto);
};

export const avisarPagamentoEstornadoService = async (
  evento: EnvelopeRecebido,
  dados: PagamentoEstornadoDados
): Promise<void> => {
  const texto =
    `Olá! O pedido ${evento.pedidoId} foi cancelado e o valor pago foi estornado.\n\n` +
    `Valor estornado: ${moeda.format(dados.valor)}\n` +
    `Transação: ${dados.codigoTransacao}\n\n` +
    `O estorno pode levar alguns dias para aparecer na fatura.`;

  await enviar(evento, dados.clienteEmail, "Estorno do seu pagamento", texto);
};
