# ADR 0008: Saga por coreografia com compensações

Status: aceita (aula 09)

## Contexto
A compra atravessa três bancos (Postgres de pedidos, Mongo do catálogo, Postgres de pagamentos) e um banco de cartão externo. Não existe `ROLLBACK` que desfaça os quatro. Commit em duas fases (2PC) não serve: Kafka, Mongo e o banco externo não participam, e todos teriam de estar no ar.

## Decisão
Saga por **coreografia** (a mesma do ADR 0007): cada passo é uma transação local e tem uma compensação, disparada por evento.

| Passo | Serviço | Compensação |
|---|---|---|
| Criar o pedido | pedidos | marcar `CANCELADO` com motivo |
| Reservar estoque | catalogo | devolver ao disponível |
| Cobrar | pagamentos | estornar (`ESTORNADO`) ou bloquear a cobrança futura (`CANCELADO`) |
| Avisar o cliente | notificacoes | outro e-mail |

- Novo serviço `pagamentos`, Postgres próprio, tópico `pagamentos` e eventos `pedido.cancelado`, `pagamento.aprovado`, `pagamento.recusado` e `pagamento.estornado`.
- Ordem pelo custo de desfazer: o estoque (barato de devolver) é reservado **antes** de cobrar (estorno custa taxa e aparece no extrato).
- Idempotência por chave única (`pagamentos.pedido_id`) e por filtro de estado.
- `estoque.reservado` leva `cartaoFinal`, para o pagamento não consultar outro serviço.
- Recusa do banco e banco fora resultam no mesmo `pagamento.recusado` (motivos diferentes).
- Cancelar depois de `PAGO` não é permitido (409).

## Consequências
- Sem isolamento: outros serviços enxergam estados intermediários (`AGUARDANDO_*`, estoque reservado de um pedido que vai ser recusado). O status do pedido funciona como cadeado.
- O fluxo fica difícil de ver de uma vez; o `correlationId` nos logs junta a saga de um pedido.
- Corridas tratadas: cancelamento durante a cobrança (o `pedido_id` ocupado com `CANCELADO` bloqueia a cobrança futura; cobrança já aprovada é estornada) e `pagamento.aprovado` chegando ao catálogo antes do `pedido.cancelado` (a reserva confirmada também é devolvida).
- Estorno que falha não vira estado gravado (sem `ESTORNO_PENDENTE`): ver limitações no README.
