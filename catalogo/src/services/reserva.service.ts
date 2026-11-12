import { publicar } from "../config/kafka.js";
import {
  buscarDisponivel,
  confirmarSaidaDoEstoque,
  devolverAoDisponivel,
  devolverEstoque,
  reservarEstoque,
} from "../repositories/produto.repository.js";
import {
  concluirReserva,
  criarReserva,
  mudarStatusReserva,
} from "../repositories/reserva.repository.js";
import {
  EnvelopeRecebido,
  EstoqueInsuficienteDados,
  EstoqueReservadoDados,
  ItemEvento,
  PedidoCriadoDados,
  TIPOS,
  TOPICOS,
} from "../utils/eventos.js";

// Aula 08, slide "CATALOGO: RESERVAR SEM REPETIR":
// 1) idempotência por reservas.pedidoId único; 2) tudo ou nada; 3) publica o resultado.
// Erro de Mongo/Kafka sobe (retry do kafkajs); a reentrega cai no 11000 e é ignorada (limitação D07).
export const reservarEstoqueDoPedidoService = async (
  evento: EnvelopeRecebido,
  dados: PedidoCriadoDados
): Promise<void> => {
  const { pedidoId, correlationId } = evento;

  const criou = await criarReserva(
    pedidoId,
    dados.itens.map((i) => ({ produtoId: i.produtoId, quantidade: i.quantidade }))
  );
  if (!criou) {
    console.log(
      `[correlationId=${correlationId}] evento repetido ignorado pedido.criado pedidoId=${pedidoId}`
    );
    return;
  }

  const reservados: ItemEvento[] = [];

  for (const item of dados.itens) {
    if (await reservarEstoque(item.produtoId, item.quantidade)) {
      reservados.push(item);
      continue;
    }

    // Faltou: devolve o que já tirou (tudo ou nada, RN03)
    for (const r of reservados) {
      await devolverEstoque(r.produtoId, r.quantidade);
    }

    const disponivel = await buscarDisponivel(item.produtoId);
    // Limite de 500 caracteres do contrato: nome muito longo não pode fazer o pedidos
    // descartar o evento e deixar o pedido parado em AGUARDANDO_ESTOQUE.
    const motivo = (
      disponivel === null
        ? `Produto ${item.nomeProduto} (${item.produtoId}) não encontrado no catálogo.`
        : `Estoque insuficiente para ${item.nomeProduto} (pedido: ${item.quantidade}, disponível: ${disponivel}).`
    ).slice(0, 500);

    await concluirReserva(pedidoId, "insuficiente");
    await publicar<EstoqueInsuficienteDados>(
      TOPICOS.ESTOQUE,
      TIPOS.ESTOQUE_INSUFICIENTE,
      pedidoId,
      { motivo, usuarioId: dados.usuarioId, clienteEmail: dados.clienteEmail },
      correlationId
    );
    return;
  }

  await concluirReserva(pedidoId, "reservado");
  await publicar<EstoqueReservadoDados>(
    TOPICOS.ESTOQUE,
    TIPOS.ESTOQUE_RESERVADO,
    pedidoId,
    {
      usuarioId: dados.usuarioId,
      clienteEmail: dados.clienteEmail,
      itens: dados.itens,
      valorTotal: dados.valorTotal,
      formaPagamento: dados.formaPagamento,
      cartaoFinal: dados.cartaoFinal ?? null,
    },
    correlationId
  );
};

// ---- Aula 09: a saga. As duas só agem se a reserva ainda estiver "reservado":
// esse filtro de estado é a idempotência (liberar duas vezes não devolve duas vezes).

// pagamento.aprovado: confirma a reserva. O produto sai do reservado
// (o disponível já tinha diminuído na reserva).
export const confirmarReservaService = async (evento: EnvelopeRecebido): Promise<void> => {
  const { pedidoId, correlationId } = evento;
  const reserva = await mudarStatusReserva(pedidoId, "reservado", "confirmado");
  if (!reserva) {
    console.log(
      `[correlationId=${correlationId}] ${evento.tipo} ignorado pedidoId=${pedidoId} (reserva não está mais reservada)`
    );
    return;
  }

  for (const item of reserva.itens) {
    await confirmarSaidaDoEstoque(item.produtoId, item.quantidade);
  }
  console.log(
    `[correlationId=${correlationId}] reserva confirmada pedidoId=${pedidoId} (${reserva.itens.length} item(ns) saíram do reservado)`
  );
};

// COMPENSAÇÃO (pagamento.recusado e pedido.cancelado): devolve o estoque ao disponível.
// O catálogo não sabe por que o pedido falhou: só escuta o evento e desfaz a sua parte.
export const liberarReservaService = async (evento: EnvelopeRecebido): Promise<void> => {
  const { pedidoId, correlationId } = evento;
  let reserva = await mudarStatusReserva(pedidoId, "reservado", "liberado");

  // Corrida entre tópicos: o pagamento.aprovado chegou antes do pedido.cancelado e a reserva
  // já foi confirmada. O pedido não está PAGO (pedidos não cancela PAGO) e o pagamentos estorna:
  // o estoque precisa voltar. O reservado já tinha baixado, então só o disponível sobe.
  let jaConfirmada = false;
  if (!reserva && evento.tipo === TIPOS.PEDIDO_CANCELADO) {
    reserva = await mudarStatusReserva(pedidoId, "confirmado", "liberado");
    jaConfirmada = reserva !== null;
  }

  if (!reserva) {
    console.log(
      `[correlationId=${correlationId}] ${evento.tipo} ignorado pedidoId=${pedidoId} (nada reservado para devolver)`
    );
    return;
  }

  for (const item of reserva.itens) {
    if (jaConfirmada) {
      await devolverAoDisponivel(item.produtoId, item.quantidade);
    } else {
      await devolverEstoque(item.produtoId, item.quantidade);
    }
  }
  console.log(
    `[correlationId=${correlationId}] COMPENSAÇÃO: estoque devolvido pedidoId=${pedidoId} por ${evento.tipo} (${reserva.itens.length} item(ns))`
  );
};
