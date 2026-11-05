import { publicar } from "../config/kafka.js";
import {
  buscarDisponivel,
  devolverEstoque,
  reservarEstoque,
} from "../repositories/produto.repository.js";
import { concluirReserva, criarReserva } from "../repositories/reserva.repository.js";
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
    },
    correlationId
  );
};
