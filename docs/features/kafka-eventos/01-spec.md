# Spec: kafka-eventos (Aula 08 - Kafka e Eventos)
Status: PRONTA
Data: 29/10/2026

## Objetivo
Fazer o checkout andar sozinho por eventos (coreografia): `pedidos` publica `pedido.criado`, `catalogo` reserva o estoque (tudo ou nada, sem repetir) e publica `estoque.*`, `pedidos` muda o status e o novo serviço `notificacoes` avisa o cliente por e-mail (Mailpit). Pagamento e saga ficam para a aula 09.

Fonte da verdade: `aulas/texto/08-kafka-e-eventos.txt` (slides citados por título, pois o texto não numera páginas). Slide "O QUE ENTREGAR" = escopo.

## Regras de negócio
- RN01 - Pedido nasce em `AGUARDANDO_ESTOQUE`; o checkout continua respondendo 202 e continua consultando o catálogo de forma síncrona para o preço (slide "PEDIDOS: PUBLICAR E ESCUTAR").
- RN02 - O evento `pedido.criado` só é publicado depois do COMMIT da transação do checkout; nunca anunciar pedido que pode sumir num rollback (slides "KAFKAJS: PUBLICAR" e "PEDIDOS: PUBLICAR E ESCUTAR").
- RN03 - Reserva de estoque é tudo ou nada: se um item não tem `estoque.disponivel >= quantidade`, devolve o que já tirou dos itens anteriores e publica `estoque.insuficiente` (slide "CATALOGO: RESERVAR SEM REPETIR").
- RN04 - Reservado != vendido: `disponivel` diminui e `reservado` aumenta; confirmar ou devolver é da aula 09 (mesmo slide).
- RN05 - Idempotência do catálogo: coleção `reservas` com índice único em `pedidoId`; duplicidade (código 11000) = evento já processado, ignora (mesmo slide).
- RN06 - Dois pedidos simultâneos nunca deixam o estoque negativo: o `$gte` no filtro do `updateOne` garante isso (mesmo slide).
- RN07 - Idempotência de `pedidos`: o status só muda a partir de `AGUARDANDO_ESTOQUE` (update condicional). `estoque.reservado` -> `AGUARDANDO_PAGAMENTO`; `estoque.insuficiente` -> `CANCELADO` com o motivo. Evento repetido ou atrasado não leva o pedido para trás (slides "PEDIDOS: PUBLICAR E ESCUTAR" e "O STATUS DO PEDIDO HOJE").
- RN08 - `POST /pedidos/:id/cancelar` continua permitido em `AGUARDANDO_ESTOQUE` e `AGUARDANDO_PAGAMENTO`; devolver o estoque do cancelado fica para a saga (aula 09) (slide "O STATUS DO PEDIDO HOJE").
- RN09 - Quem publica é o dono do fato: só `pedidos` publica `pedido.*`; só `catalogo` publica `estoque.*` (slide "DESENHANDO EVENTOS: NOMES").
- RN10 - Evento não leva número de cartão, senha nem documento; só `cartaoFinal` (4 dígitos) (slide "QUANTO COLOCAR DENTRO DO EVENTO?").
- RN11 - Entrega "pelo menos uma vez": todo consumer tolera receber o mesmo evento duas vezes (slides "GARANTIAS DE ENTREGA" e "IDEMPOTÊNCIA").
- RN12 - `correlationId` = `X-Request-Id` do Kong, presente em todos os eventos e em todos os logs relacionados (slide "O ENVELOPE").
- RN13 - Evento é contrato: só acrescentar campos; consumer ignora tipos que não conhece (slides "O ENVELOPE" e "EVENTO É CONTRATO").
- RN14 - `notificacoes` só escuta: sem banco, sem rota no Kong, sem porta; se cair, a loja continua e os eventos esperam (slide "NOTIFICACOES + MAILPIT").

## Requisitos funcionais
- RF01 - Compose: `kafka` (`apache/kafka:3.8.0`, KRaft broker+controller, sem `ports:`, healthcheck, `KAFKA_NUM_PARTITIONS: 3`, fator de replicação 1), `kafka-ui` (`kafbat/kafka-ui:v1.1.0`, `8090:8080`), `notificacoes` (build `./notificacoes`) e `mailpit` (`axllent/mailpit`, `8025:8025`). `pedidos`, `catalogo` e `notificacoes` com `depends_on: kafka: condition: service_healthy` e `stop_grace_period: 10s` (slides "O KAFKA NO DOCKER-COMPOSE.YML" e "NO PROJETO") (RN11).
- RF02 - `pedidos` publica `pedido.criado` no tópico `pedidos` depois do commit do checkout; chave da mensagem = id do pedido; `dados`: `usuarioId`, `clienteEmail`, `valorTotal`, `formaPagamento`, `cartaoFinal`, `itens` (RN02, RN10, RN12).
- RF03 - `catalogo` (groupId `catalogo`, tópico `pedidos`, `fromBeginning: true`) reage a `pedido.criado`: grava em `reservas` (RN05), reserva item a item (RN03, RN04, RN06) e publica no tópico `estoque`: `estoque.reservado` (`dados`: `usuarioId`, `clienteEmail`, `itens`, `valorTotal`, `formaPagamento`) ou `estoque.insuficiente` (`dados`: `motivo`, `usuarioId`, `clienteEmail`). Chave = id do pedido.
- RF04 - `pedidos` (groupId `pedidos`, tópico `estoque`) reage a `estoque.reservado` e `estoque.insuficiente` (RN07). O motivo do cancelamento é gravado e exposto no `GET /pedidos` e `GET /pedidos/:id` (campo novo `motivo_cancelamento`, aditivo).
- RF05 - `notificacoes` (groupId `notificacoes`, tópicos `pedidos` e `estoque`) envia via nodemailer (`mailpit:1025`, `secure: false`): assunto "Recebemos o seu pedido" em `pedido.criado` e e-mail de "sem estoque" em `estoque.insuficiente`, para `dados.clienteEmail`. Outros tipos: ignora (RN13, RN14).
- RF06 - Tópicos `pedidos` e `estoque` criados por quem sobe primeiro: `admin.listTopics()` + `admin.createTopics()` com 3 partições (replicationFactor 1), em cada serviço que usa Kafka.
- RF07 - Cada consumer chama `consumer.disconnect()` no `SIGTERM` (`process.once`); producers também desconectam.
- RF08 - Logs de publicação, consumo e erro incluem `correlationId` (formato único `[correlationId=<id>]`, como o `errorHandler` do pedidos já faz com `x-request-id`) (RN12).
- RF09 - `requests/pedidos.http`: caminho feliz (202 -> consultar até `AGUARDANDO_PAGAMENTO`; conferir `estoque.disponivel` e `reservado` no catálogo) e sem estoque (3 unidades do "Celular Básico" -> `CANCELADO` com motivo), mais instruções de conferir Kafka UI (8090), Mailpit (8025) e `docker compose logs | grep <correlationId>` (slide "TESTANDO O FLUXO").
- RF10 - README: tabela de eventos, ADR novo (Kafka/coreografia; Kafka UI e Mailpit publicam porta), limitações conhecidas Outbox e DLQ, novas portas 8090 e 8025, estrutura com `notificacoes/` (slides "AS ARMADILHAS" e "O QUE ENTREGAR").
- RF11 - Seed do catálogo ganha, de forma idempotente (`findOneAndUpdate` + `upsert`, como os demais), o produto "Celular Básico" com `estoque.disponivel = 2` (slide "TESTANDO O FLUXO").

## Projetos envolvidos
| Projeto (pasta) | Perfil | Papel na feature | Versões relevantes |
|---|---|---|---|
| `pedidos/` | aulas-ecommerce (hook: api-express) | Produz `pedido.criado`; consome `estoque.*`; migration manual (`motivo_cancelamento`) | Node 22, TS strict ESM, Express 4, Prisma 6, Zod 3; novo: `kafkajs` |
| `catalogo/` | aulas-ecommerce | Consome `pedido.criado`; produz `estoque.*`; model `Reserva`; seed | Mongoose 8, MongoDB 7, Express 4, Zod 3; novo: `kafkajs` |
| `notificacoes/` (NOVO) | aulas-ecommerce | Só consumer + SMTP; sem banco, sem HTTP, sem Kong | Node 22, TS strict ESM, Zod 3; novo: `kafkajs`, `nodemailer` (+ `@types/nodemailer`) |
| raiz (`docker-compose.yml`, `README.md`, `.env.example`, `requests/`) | - | Infra, docs, testes | Kafka 3.8.0, kafka-ui v1.1.0, Mailpit |
| `usuarios/`, `kong/` | - | Não alterados. Kong não ganha rota (RN14); `correlation-id` global já existe em `kong/kong.yml` | Kong 3.9 |

## Requisitos não funcionais
- Bancos alvo: PostgreSQL 16 (`pedidos`) e MongoDB 7 (`catalogo`). Tabelas/coleções compartilhadas entre serviços: nenhuma (cada um com banco próprio; o único elo é o evento). `notificacoes` sem banco.
- Segurança: nenhuma rota nova, então nada de JWT/ACL/Kong. Kafka sem autenticação (PLAINTEXT) e sem porta publicada, só rede `ecommerce-net`. `kafka-ui` (8090) e `mailpit` (8025) publicam porta por exigência da aula (ver divergências); sem autenticação, uso só local/didático. Evento sem dado sensível (RN10); e-mail do cliente trafega no evento por decisão da aula. Nunca devolver `senha_hash`.
- Performance: volume didático. Producer único por processo, conectado na subida (slide "KAFKAJS: PUBLICAR"). Reserva = um `updateOne` por item (aceitável: poucos itens por pedido, a aula usa o mesmo laço).
- Concorrência: reserva (RN05, RN06); mudança de status com `updateMany` condicional e checagem de `count` (RN07); chave = id do pedido garante ordem por pedido; 3 partições = teto de 3 réplicas por grupo.
- Fuso: `ocorridoEm` em ISO 8601 UTC (`new Date().toISOString()`); colunas `Timestamptz`.
- Execução: processos Node com HTTP (`pedidos`, `catalogo`) passam a ter também producer/consumer no mesmo processo; `notificacoes` é só consumer (processo sem servidor HTTP). Consumer e producer sobem depois do banco conectado; falha de conexão com o Kafka na subida derruba o processo (`restart: unless-stopped` reinicia).

## Mapa da aula (o que já existe x o que falta)
Confirmado no código:
- `docker-compose.yml`: sem Kafka, kafka-ui, mailpit ou notificacoes. `pedidos` tem `depends_on` de `postgres-pedidos` (healthy) e `catalogo` (started); `catalogo` só de `mongo-catalogo` (started). Nenhum tem `stop_grace_period`. Rede `ecommerce-net`; só o gateway publica portas. Volumes: `postgres_usuarios_data`, `mongo_catalogo_data`, `postgres_pedidos_data`.
- `pedidos/src/controllers/pedido.controller.ts`: `POST /pedidos` -> 202 e já repassa `req.header("x-request-id")` ao `checkoutService`, que o repassa a `buscarProdutos` (`pedidos/src/catalogo.ts`, timeout 3000 ms, lote `?ids=`, Zod). O `requestId` ainda não chega ao repositório nem à publicação.
- `pedidos/src/repositories/pedido.repository.ts`: `criarPedidoEEsvaziarCarrinho` usa `prisma.$transaction` e retorna `PedidoComItens` (select explícito, `satisfies Prisma.PedidoSelect`); o commit acontece quando a função retorna, então o ponto de publicação é no service, depois do `await`. Já existe `cancelarPedidoDoUsuario` com `updateMany` condicional (modelo para a nova função de mudança de status, que não filtra por `usuario_id`).
- `pedidos/prisma/schema.prisma`: enum `StatusPedido` com os 4 status; `Pedido` tem `usuario_id`, `cliente_email`, `valor_total` (Decimal 12,2), `forma_pagamento`, `cartao_final`, `itens` (`produto_id`, `nome_produto`, `preco_unitario`, `quantidade`). **Não há coluna de motivo de cancelamento.** Migration existente: `20261029120000_init` (não editar; criar nova à mão).
- `pedidos/src/config/env.ts`: sem variáveis do Kafka. `pedidos/src/index.ts`: só `app.listen`, sem ciclo de vida de consumer/SIGTERM. `pedidos/package.json`: sem `kafkajs`. `pedidos/Dockerfile`: `CMD` roda `npx prisma migrate deploy && node dist/index.js` (a nova migration entra sozinha).
- `catalogo/src/models/produto.model.ts`: `estoque { disponivel, reservado }` (min 0). Não existe model de reserva. `catalogo/src/index.ts` conecta o Mongo e sobe o Express. `catalogo/Dockerfile`: `CMD npm run seed && node dist/index.js`.
- `catalogo/seeds/seed.ts`: 10 produtos; menor estoque é `CEL-004` (Smartphone Fold Ultra, 5 un.). **Não existe "Celular Básico" com 2 unidades.** O pedidos.http usa `CEL-001` (10 un.) e `CAM-010` (40 un.) no caminho feliz, que cabem no estoque.
- `kong/kong.yml`: plugin global `correlation-id` (`X-Request-Id`, uuid, `echo_downstream: true`) já presente; header chega aos serviços.
- `requests/pedidos.http`: já cobre carrinho, checkout (202), consulta, 404, cancelamento (409) e catálogo fora (503); falta o fluxo por eventos. (Arquivos `requests/catalogo.http` e `requests/pedidos.http` estão modificados e não commitados no git: o dev-backend deve usar Edit sobre o estado atual.)
- `notificacoes/`: não existe.
- Não há `package.json` na raiz; `.env.example` só tem `JWT_SECRET`.

## Contrato de eventos (slide "TÓPICOS E EVENTOS")
Envelope (todos): `{ id, tipo, pedidoId, ocorridoEm, correlationId, dados }`. `id` = UUID do evento (`crypto.randomUUID()`), `value` = `JSON.stringify(envelope)`, `key` = `pedidoId`.

| Evento | Tópico | Publica | Consome | `dados` |
|---|---|---|---|---|
| `pedido.criado` | `pedidos` | pedidos | catalogo, notificacoes | `usuarioId`, `clienteEmail`, `valorTotal`, `formaPagamento`, `cartaoFinal`, `itens` |
| `estoque.reservado` | `estoque` | catalogo | pedidos (pagamentos na aula 09) | `usuarioId`, `clienteEmail`, `itens`, `valorTotal`, `formaPagamento` |
| `estoque.insuficiente` | `estoque` | catalogo | pedidos, notificacoes | `motivo`, `usuarioId`, `clienteEmail` |

Group ids: `pedidos`, `catalogo`, `notificacoes`. Cada serviço tem o seu `src/config/kafka.ts` (cliente, producer, helper `publicar(topico, tipo, pedidoId, dados, correlationId)`, `garantirTopicos`, `criarConsumer`), sem importar código de outro serviço (CLAUDE.md); a duplicação é intencional ("um kafka.js igual em cada um", slide "O ENVELOPE").

Formato dos itens (decisão, ver abaixo): `{ produtoId, nomeProduto, precoUnitario, quantidade }` em camelCase; `valorTotal` como número (a aula usa número: `"valorTotal": 120`); `ocorridoEm` ISO UTC.

## Entidades
| Entidade | Campo | Tipo lógico | Obrigatório | Restrições |
|---|---|---|---|---|
| `pedidos` (Postgres, ALTER) | `motivo_cancelamento` | texto | não (NULL) | `TEXT`; preenchido só por `estoque.insuficiente`; migration manual `prisma/migrations/<AAAAMMDDHHMMSS>_motivo_cancelamento/migration.sql` com `ALTER TABLE "pedidos" ADD COLUMN "motivo_cancelamento" TEXT;` coerente com `schema.prisma` (`String? @db.Text`). Posterior a `20261029120000` |
| `reservas` (Mongo, NOVA, model `Reserva`) | `pedidoId` | string | sim | índice **único** (11000 -> 409 no padrão do projeto, aqui "ignora"); não é ObjectId |
| | `itens` | array de `{ produtoId, quantidade }` | sim | cópia dos itens do evento |
| | `status` | enum `processando` / `reservado` / `insuficiente` | sim | começa `processando` (aula); atualizado ao concluir |
| | `criado_em`, `atualizado_em` | datas | sim | `timestamps: { createdAt: "criado_em", updatedAt: "atualizado_em" }`, `versionKey: false` |
| `produtos.estoque` (existente) | `disponivel`, `reservado` | número | sim | só via `$inc` com `$gte` na reserva |
| Tópicos Kafka | `pedidos`, `estoque` | - | - | 3 partições, replicação 1, retenção padrão (7 dias) |

## Fluxos do usuário
1. Cliente faz `POST /pedidos` pelo Kong (X-Request-Id gerado) -> `pedidos` grava pedido + itens e esvazia o carrinho (transação) -> publica `pedido.criado` (key = id do pedido) -> responde 202 com o pedido em `AGUARDANDO_ESTOQUE`.
2. `catalogo` lê `pedido.criado`: insere em `reservas` (11000 = ignora); para cada item `updateOne({ _id, "estoque.disponivel": { $gte: qtd } }, { $inc: { disponivel: -qtd, reservado: +qtd } })`.
3. Caminho feliz: todos os itens ok -> `reservas.status = reservado` -> publica `estoque.reservado`. `pedidos` lê e muda para `AGUARDANDO_PAGAMENTO` (só a partir de `AGUARDANDO_ESTOQUE`).
4. Sem estoque: `modifiedCount = 0` em algum item -> devolve com `$inc` inverso os itens já reservados -> `reservas.status = insuficiente` -> publica `estoque.insuficiente` com `motivo` (nome do produto e quantidades). `pedidos` muda para `CANCELADO` e grava `motivo_cancelamento`.
5. `notificacoes` envia e-mail "Recebemos o seu pedido" ao ler `pedido.criado` e e-mail de "sem estoque" ao ler `estoque.insuficiente`; cliente confere em `localhost:8025`.
6. Cliente consulta `GET /pedidos/:id` até o status mudar (polling; consistência eventual, slide "CONSISTÊNCIA EVENTUAL"). Operador acompanha tópicos, chaves e lag em `localhost:8090`.
7. `docker compose logs | grep <correlationId>` mostra a compra inteira (pedidos, catalogo, notificacoes).
8. Parada do container: `SIGTERM` -> `consumer.disconnect()` -> sai do grupo na hora (grace period 10 s).

## Código existente reaproveitável
| Caminho | O que reaproveitar |
|---|---|
| `pedidos/src/services/pedido.service.ts` (`checkoutService`) | Ponto da publicação (após `criarPedidoEEsvaziarCarrinho`); já recebe `requestId` |
| `pedidos/src/repositories/pedido.repository.ts` | Padrão `updateMany` condicional (`cancelarPedidoDoUsuario`), `pedidoSelect` (acrescentar `motivo_cancelamento`) |
| `pedidos/src/catalogo.ts` | Modelo de `fetch` + Zod + erro específico; referência de estilo |
| `pedidos/src/middleware/errorHandler.ts` | Formato de log `[x-request-id=...]` |
| `pedidos/src/config/env.ts`, `catalogo/src/config/env.ts` | Objeto `env` (acrescentar `KAFKA_BROKERS`, e no novo serviço `SMTP_HOST`/`SMTP_PORT`/`MAIL_FROM`); não ler `process.env` fora dele |
| `catalogo/src/models/produto.model.ts` | Padrão de model (timestamps, `versionKey: false`); `IEstoque` |
| `catalogo/src/repositories/produto.repository.ts` | Padrão de repository; novo repository de reservas e função de reserva/devolução de estoque |
| `catalogo/seeds/seed.ts` | `findOneAndUpdate` com `upsert` para o novo produto |
| `catalogo/src/config/db.ts`, `pedidos/src/config/db.ts` | Conexão antes de iniciar consumer |
| `pedidos/Dockerfile`, `catalogo/Dockerfile` | Base do Dockerfile de `notificacoes` (sem `openssl`, sem Prisma, sem `EXPOSE`, `CMD node dist/index.js`) |
| `pedidos/tsconfig.json`, `package.json` | Copiar para `notificacoes/` (ESM, NodeNext, strict) |
| `kong/kong.yml` (`correlation-id`) | Origem do `correlationId`; nenhuma alteração |

## Divergências aula x projeto (decisão: aula vence quando a regra é dela; CLAUDE.md vence só na forma)
| Aula | Projeto | Decisão |
|---|---|---|
| JS CommonJS (`require('kafkajs')`) | TS strict, ESM, imports `.js`, sem `any` | `kafkajs` tipado; `src/config/kafka.ts` por serviço; envelope tipado e validado com Zod no consumer; sem importar código entre serviços |
| SQL cru `UPDATE ... WHERE status = ANY($3)` | Prisma | `prisma.pedido.updateMany({ where: { id, status: { in: [AGUARDANDO_ESTOQUE] } }, data })` e checagem de `count` (evento repetido = `count 0` = ignora, sem erro) |
| `db.reservas` (driver cru) | Mongoose | Model `Reserva` em `src/models/reserva.model.ts`, coleção `reservas`; `Reserva.create` e captura de `code === 11000` (erro tipado, sem `any`); atualização de produto via `Produto.updateOne` com operadores `$gte`/`$inc` |
| Kafka UI e Mailpit com `ports:` | "Só o gateway publica portas" | Aula vence; registrar no ADR novo. Kafka, bancos, `notificacoes` e demais serviços continuam sem porta |
| Pasta `http/pedidos.http` | `requests/` | Manter `requests/pedidos.http` |
| Seed do catálogo com "Celular Básico" (2 un.) | Seed sem esse produto | Acrescentar ao seed, idempotente: sku `CEL-005`, nome "Celular Básico", categoria `celulares`, `estoque { disponivel: 2, reservado: 0 }`. Rodar o seed de novo não repõe o estoque consumido pelo teste? `$set` do seed sobrescreve `estoque` a cada subida do container (comportamento já existente em todos os produtos); aceito e registrado |
| `x-request-id` na aula | Kong já injeta | Sem divergência |
| Aula usa `notification-service`/`order-service` (docker-class) | Nomes do projeto: `notificacoes`, `pedidos`, `catalogo` | Usar nomes do projeto |

## Decisões assumidas
- D01 - Estrutura em camadas para consumers: `src/consumers/<assunto>.consumer.ts` (equivalente ao controller: parse/validação do envelope + despacho por `tipo`, `try/catch` com log e relançamento) -> `src/services/*.service.ts` (regra) -> `src/repositories/*.repository.ts`. Publicação via `src/config/kafka.ts`. Decisão final de nomes é do arquiteto.
- D02 - Itens do evento em camelCase (`produtoId`, `nomeProduto`, `precoUnitario`, `quantidade`), pois o envelope da aula é camelCase (`pedidoId`, `ocorridoEm`, `usuarioId`) e difere do snake_case do banco; o service de pedidos faz o mapeamento. `valorTotal` e `precoUnitario` como número (conversão de `Prisma.Decimal` com `.toNumber()` no momento de montar o evento).
- D03 - `clienteEmail` vem de `usuario.email` (cabeçalho `X-User-Email` já lido pelo `lerIdentidade`); `usuarioId` de `usuario.id`; `cartaoFinal` de `cartao_final` (pode ser `null`).
- D04 - Falha ao publicar depois do commit (Kafka fora): registrar erro com `correlationId` e ainda responder 202 (o pedido existe e foi gravado); o pedido fica em `AGUARDANDO_ESTOQUE` até alguém tratar. É exatamente a limitação "escrita dupla" (Outbox) da aula. Alternativa rejeitada: 503 (enganoso, pois o pedido foi criado e o carrinho esvaziado).
- D05 - `correlationId` ausente (chamada direta, sem Kong): gerar `randomUUID()` no ponto de publicação para o envelope nunca ficar vazio.
- D06 - Evento inválido (JSON ou Zod falha) ou `tipo` desconhecido: tipo desconhecido é ignorado em silêncio (RN13); JSON/Zod inválido é logado como erro e descartado (commit segue). Sem DLQ (limitação). Erro de infraestrutura no handler (Mongo/Postgres/SMTP fora) é relançado para o kafkajs tentar de novo (retry nativo do kafkajs, sem commit).
- D07 - `reservas.status` nasce `processando` (slide) e é atualizado para `reservado`/`insuficiente` ao final. Se o processo cair entre o insert e o fim, a reentrega cai em 11000 e é ignorada (comportamento da aula): risco de reserva parcial sem evento publicado. Registrar como limitação conhecida (mesma família de Outbox); não resolver nesta aula.
- D08 - Produto inexistente, `_id` inválido ou sem estoque tratados igual: `modifiedCount = 0` -> `estoque.insuficiente`, `motivo` legível em PT-BR (ex.: "Estoque insuficiente para Celular Básico (pedido: 3, disponível: 2)"). `ativo: true` não entra no filtro (aula não o prevê; o checkout já filtra inativos).
- D09 - Compose Kafka (padrão do exemplo oficial do `apache/kafka`): `KAFKA_NODE_ID: 1`, `KAFKA_PROCESS_ROLES: broker,controller`, `KAFKA_LISTENERS: PLAINTEXT://:9092,CONTROLLER://:9093`, `KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092`, `KAFKA_CONTROLLER_LISTENER_NAMES: CONTROLLER`, `KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT`, `KAFKA_INTER_BROKER_LISTENER_NAME: PLAINTEXT`, `KAFKA_CONTROLLER_QUORUM_VOTERS: 1@kafka:9093`, `KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1`, `KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: 1`, `KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: 1`, `KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS: 0`, `KAFKA_NUM_PARTITIONS: 3`. Healthcheck: `/opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list` (o slide mostra `kafka-topics.sh ... --list`), com `interval`/`timeout`/`retries`/`start_period` generosos.
- D10 - Volume nomeado `kafka_data` (`/var/lib/kafka/data`) para os tópicos e offsets sobreviverem a `docker compose down` sem `-v`, coerente com os bancos que têm volume. Sem ele, o reinício reprocessaria `fromBeginning` contra bancos que já têm dados (idempotência cobre, mas gera e-mails repetidos).
- D11 - `kafka-ui`: `KAFKA_CLUSTERS_0_NAME: local`, `KAFKA_CLUSTERS_0_BOOTSTRAPSERVERS: kafka:9092`, `depends_on kafka service_healthy`, `networks: ecommerce-net`. `mailpit`: `networks: ecommerce-net`, porta 1025 só interna. `notificacoes`: `depends_on` kafka (healthy) e mailpit (started), `KAFKA_BROKERS: kafka:9092`, `SMTP_HOST: mailpit`, `SMTP_PORT: 1025`.
- D12 - `.env.example` da raiz: nenhuma variável secreta nova (Kafka/SMTP internos, com default no compose); `.env.example` de `pedidos/` e `catalogo/` ganham `KAFKA_BROKERS=localhost:9092` (uso fora do Docker não é suportado, pois o Kafka não publica porta; manter só como documentação) e `notificacoes/.env.example` novo. Gateway `depends_on` não precisa listar `notificacoes` (não tem rota).
- D13 - Retorno de `GET /pedidos` e `GET /pedidos/:id` ganha `motivo_cancelamento` (nullable). Cancelamento manual do cliente deixa `NULL` (não há motivo informado pela API; sem mudar contrato do POST cancelar).
- D14 - `notificacoes` não repete e-mail por idempotência (sem banco): reentrega pode gerar e-mail duplicado; aceito pela aula ("receber o aviso duas vezes é melhor que perder", slide "GARANTIAS DE ENTREGA"). Texto dos e-mails em PT-BR, simples (`text`), com id do pedido e valor `R$ 1.234,56`.
- D15 - README: novo ADR numerado em sequência (ADR 007: Kafka/coreografia com idempotência por chave única e filtro de estado; exceções de porta para Kafka UI 8090 e Mailpit 8025; Outbox e DLQ como limitações); atualizar a tabela de portas, diagrama, estrutura, "Como Executar" (serviços que sobem) e o parágrafo do ADR 006 que diz "quem o faz andar é o Kafka, na próxima aula". O README não tem ainda tabela de eventos: criar.
- D16 - Dependências: `kafkajs` (^2.2.4, traz tipos próprios), `nodemailer` (+ `@types/nodemailer`), instalados com `npm install` dentro de cada serviço (npm exclusivamente). `notificacoes` usa `dotenv` e `zod` como os demais.
- D17 - Hook do plugin classifica pastas com `package.json` como `api-express`: `notificacoes/` entra no escopo de escrita do dev-backend assim que existir (o `package.json` precisa ser criado cedo); ele não exige Prisma, Joi ou rotas.
- D18 - Tag git `aula-kafka` (checkpoint da aula): fora do escopo; só com pedido explícito do usuário. Commit e push idem.

## Fora do escopo
Pagamentos, saga, devolução de estoque por cancelamento ou pagamento recusado (aula 09); Outbox; DLQ; Schema Registry; múltiplos brokers; réplicas de consumer; autenticação do Kafka; teste automatizado (sem suíte no projeto).

## Limitações conhecidas (a documentar no README, slide "AS ARMADILHAS")
- Escrita dupla: Kafka fora entre o commit e a publicação deixa o pedido parado em `AGUARDANDO_ESTOQUE` (solução: padrão Outbox).
- Mensagem venenosa: evento com defeito é descartado após log, sem tópico de erros (solução: DLQ).
- Reserva parcial se o catálogo cair entre o insert em `reservas` e a conclusão (D07).
- Cancelamento manual de pedido com estoque reservado não devolve estoque (aula 09, RN08).
- `fromBeginning: true` reprocessa o histórico para grupo novo; idempotência cobre catálogo e pedidos, não os e-mails.
- Kafka UI e Mailpit sem autenticação, com porta publicada.

## Referências
- Aula: `aulas/texto/08-kafka-e-eventos.txt` (slides "O QUE ENTREGAR", "TÓPICOS E EVENTOS", "O ENVELOPE", "O KAFKA NO DOCKER-COMPOSE.YML", "KAFKAJS: PUBLICAR/CONSUMIR", "CATALOGO: RESERVAR SEM REPETIR", "NOTIFICACOES + MAILPIT", "TESTANDO O FLUXO", "AS ARMADILHAS").
- CLAUDE.md da raiz (perfil `aulas-ecommerce`).
- Kafka (imagem oficial Docker): https://hub.docker.com/r/apache/kafka
- KafkaJS (producer, consumer, admin `createTopics`): https://kafka.js.org/docs/getting-started
- Kafka UI (kafbat): https://ui.docs.kafbat.io/
- Mailpit: https://mailpit.axllent.org/docs/
- Nodemailer: https://nodemailer.com/

## Perguntas em aberto
Nenhuma. Tudo o que a aula define está registrado como requisito; os detalhes secundários estão em "Decisões assumidas".
