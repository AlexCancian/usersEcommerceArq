# 01 - Spec: Saga e resiliência (aula 09)

Fonte da verdade: `aulas/texto/09-saga-e-resiliencia.txt` (PDF "09 - Arq. Sis. - Saga e Resiliência").
Branch: `feat/aula-09-saga-pagamentos`. Checkpoint pedido pela aula: tag `aula-saga`.

## Objetivo
O pedido para em `AGUARDANDO_PAGAMENTO` desde a aula 08. Entram o serviço `pagamentos` e o `banco-falso`, e cada
serviço aprende a desfazer a sua parte quando o pagamento é recusado ou o pedido é cancelado (slide "NO PROJETO: O PAGAMENTO ENTRA NA SAGA").

## Requisitos (slides "O QUE ENTREGAR" 1/3, 2/3, 3/3)
| # | Requisito | Onde |
|---|---|---|
| R1 | banco-falso na 9000, fora do Kong: `POST /cobrancas` (0002 → 402), `POST /estornos`, `GET/POST /config` (latenciaMs, falhaPercent → 503) | `banco-falso/` |
| R2 | pagamentos com Postgres próprio, tabela `pagamentos` (`pedido_id` UNIQUE, 6 status, tentativas, codigo_transacao, motivo), consumer group `pagamentos`, escuta `estoque.reservado`, publica `pagamento.aprovado/recusado` | `pagamentos/` |
| R3 | Timeout 2 s, retry 3× (500 ms, 1 s) só para timeout/rede/5xx, circuit breaker (opossum, 15 s), estado no `/health` | `pagamentos/src/banco.ts` |
| R4 | Compensações: catálogo confirma (aprovado) ou devolve (recusado, cancelado), só se a reserva ainda estiver reservada; pedidos → PAGO / CANCELADO com motivo | `catalogo/`, `pedidos/` |
| R5 | `POST /pedidos/:id/cancelar` publica `pedido.cancelado`; pagamentos estorna o cobrado ou bloqueia a cobrança futura | `pedidos/`, `pagamentos/` |
| R6 | E-mails de pagamento aprovado, recusado (com motivo) e estornado | `notificacoes/` |
| R7 | Rotas `/pagamentos` no Kong, `/health/pagamentos` público, `.http` com os cenários, README com eventos e demo do circuit breaker, logs com pedidoId e correlationId | raiz |

## Decisões (aprovadas pelo usuário em 05/11/2026)
- D1. Status do pagamento como `enum` Prisma (a aula usa TEXT + CHECK; mesmo efeito, padrão do projeto).
- D2. Kong com duas routes: `GET /pagamentos$` admin (`*so-admin`) e `GET /pagamentos/[^/]+$` logado. A aula põe tudo como logado e o serviço confere; o CLAUDE.md diz que o 403 é do gateway. O serviço confere o perfil de novo (defesa em profundidade).
- D3. `PAGO` só a partir de `AGUARDANDO_PAGAMENTO` (regra da aula); a corrida com `estoque.reservado` fica como limitação.
- D4. `.http` em `requests/` (`fluxo-compra.http`, `demos.http`, `pagamentos.http`), não em `http/`.
- D5. Corrigida a pendência da aula 08: seed do catálogo grava `estoque` só com `$setOnInsert`.
- D6. Só os três e-mails pedidos na entrega (aprovado, recusado, estornado); sem e-mail de `pedido.cancelado`.

## Divergências / complementos em relação aos slides
- O código do slide "AO RECEBER PEDIDO.CANCELADO" não trata pagamento `PENDENTE` (cobrança em andamento em outra réplica): implementado marcando `CANCELADO` a partir de `PENDENTE`; quem está cobrando estorna se aprovar.
- `pagamento.aprovado` pode chegar ao catálogo antes do `pedido.cancelado` (tópicos diferentes): a liberação também aceita reserva `confirmado` quando o evento é `pedido.cancelado`.
- Reentrega de `estoque.reservado` com pagamento já decidido republica o resultado (cobre falha do Kafka entre o update e o publish); com `PENDENTE`, retoma a cobrança (o banco é idempotente pela referência).
- Estornos do banco-falso não sofrem latência nem falha simulada (o slide de timeout mostra o estorno passando com latência 3000).
- Idempotência por `referencia` no banco-falso implementada (o slide diz "opcional", mas o cenário de timeout depende dela).
