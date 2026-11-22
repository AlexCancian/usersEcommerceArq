# ADR 0007: Kafka e coreografia por eventos

Status: aceita (aula 08)

## Contexto
O checkout síncrono fazia `pedidos` esperar o catálogo para tudo. Reservar estoque e avisar o cliente não precisam acontecer dentro da requisição, e novos interessados (notificações, pagamentos) não deveriam obrigar `pedidos` a conhecê-los.

## Decisão
- Um broker Kafka 3.8 em KRaft, fator de replicação 1, sem porta publicada.
- Um tópico por entidade (`pedidos`, `estoque` e, na aula 09, `pagamentos`), 3 partições, chave da mensagem = id do pedido (eventos do mesmo pedido chegam em ordem).
- Envelope único `{ id, tipo, pedidoId, ocorridoEm, correlationId, dados }`; `correlationId` = `X-Request-Id` do Kong.
- **Coreografia**: ninguém orquestra; cada serviço reage aos eventos e publica os seus. A publicação acontece depois do commit.
- Idempotência: chave única (`reservas.pedidoId`) e filtro de estado (`updateMany` a partir de `AGUARDANDO_ESTOQUE`), porque a entrega é "pelo menos uma vez".
- `notificacoes` só escuta (sem banco) e envia e-mail pelo Mailpit.
- Kafka UI (8090) e Mailpit (8025) publicam porta, sem autenticação, só para uso local.

## Consequências
- Consistência eventual: o cliente consulta o pedido até ele sair de `AGUARDANDO_ESTOQUE`. O `POST /pedidos` responde 202.
- O checkout não recusa mais por falta de estoque: quem decide é o catálogo, por `estoque.insuficiente`.
- O fluxo fica espalhado pelos serviços; o `correlationId` nos logs o reúne (ADR 0010).
- Escrita dupla sem Outbox (commit e publicação são passos separados) e sem DLQ: limitações registradas no README.
- Kafka UI e Mailpit são exceções à regra "só o gateway publica portas".
