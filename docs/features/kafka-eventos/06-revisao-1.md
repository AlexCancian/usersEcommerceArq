# Revisão: kafka-eventos
Data: 30/10/2026
Rodada: 1
Veredito: REPROVADO

Perfil: `aulas-ecommerce` (CLAUDE.md da raiz). Conferido contra `aulas/texto/08-kafka-e-eventos.txt` (slide "O QUE ENTREGAR"), `01-spec.md`, `02-validacao.md` (D01–D25, D19 confirmada pelo usuário), `03-contrato-api.md` e `04-plano-backend.md`.

## Repositórios revisados
| Repositório | Perfil | Branch base | Arquivos alterados |
|---|---|---|---|
| `usersEcommerceArq` (raiz, um `.git`) | aulas-ecommerce (hook: api-express) | `main` (mudanças não commitadas) | Modificados: `docker-compose.yml`, `README.md`, `pedidos/` (`schema.prisma`, `env.ts`, `index.ts`, `pedido.repository.ts`, `pedido.service.ts`, `Dockerfile`, `.env.example`, `package*.json`), `catalogo/` (`env.ts`, `index.ts`, `produto.repository.ts`, `seeds/seed.ts`, `Dockerfile`, `.env.example`, `package*.json`), `requests/pedidos.http`, `requests/catalogo.http` (mudanças anteriores à feature). Novos: migration `20261029150000_motivo_cancelamento`, `pedidos/src/{config/kafka.ts,utils/eventos.ts,consumers/estoque.consumer.ts}`, `catalogo/src/{config/kafka.ts,utils/eventos.ts,models/reserva.model.ts,repositories/reserva.repository.ts,services/reserva.service.ts,consumers/pedidos.consumer.ts}`, `notificacoes/` (serviço inteiro). `kong/` e `usuarios/` intocados |

## Comandos (por repositório)
| Pasta | Comando | Resultado | Resumo |
|---|---|---|---|
| `pedidos/` | `npx prisma validate` (com `DATABASE_URL` inline) | PASSOU | "The schema at prisma\schema.prisma is valid" |
| `pedidos/` | `npx prisma generate` | PASSOU | exit 0 |
| `pedidos/` | `npx tsc --noEmit` | PASSOU | exit 0, sem erros |
| `pedidos/` | `npm run build` | PASSOU | exit 0 |
| `catalogo/` | `npx tsc --noEmit` | PASSOU | exit 0 |
| `catalogo/` | `npm run build` | PASSOU | exit 0 |
| `catalogo/` | `tsc --noEmit seeds/seed.ts` (fora do tsconfig; checagem extra) | PASSOU | sem erros |
| `notificacoes/` | `npx tsc --noEmit` | PASSOU | exit 0 |
| `notificacoes/` | `npm run build` | PASSOU | exit 0 |
| raiz | `docker compose config --quiet` | PASSOU | exit 0. Portas publicadas: 8080, 8001, 8002 (gateway), 8090 (kafka-ui), 8025 (mailpit). Nada mais |
| — | `npm run lint` / `npm test` | N/A | scripts inexistentes no projeto |

Pendência para o usuário: `docker compose up -d --build` e rodar as seções 6 e 7 de `requests/pedidos.http` (não executado nesta revisão, conforme o CLAUDE.md).

## Checklist — aula 08 ("O QUE ENTREGAR")
| # | Item | Resultado | Local |
|---|---|---|---|
| A1 | Kafka KRaft + Kafka UI no compose; serviços esperam o Kafka healthy | OK | `docker-compose.yml:148-198` (kafka sem `ports:`, healthcheck, `KAFKA_LOG_DIRS` + volume `kafka_data`, `CLUSTER_ID` fixo); `depends_on kafka: service_healthy` em catalogo (`:97-101`), pedidos (`:139-145`), notificacoes, kafka-ui; `stop_grace_period: 10s` nos três |
| A2 | `pedido.criado` depois do commit, envelope, chave = id do pedido | OK | `pedidos/src/services/pedido.service.ts:80-120` (publica após `await criarPedidoEEsvaziarCarrinho`, falha → log e 202, D04); `pedidos/src/config/kafka.ts:59-84` (`key: pedidoId`, envelope completo, `DefaultPartitioner`) |
| A3 | Catálogo reserva tudo ou nada, sem repetir, publica `estoque.*` | OK | `catalogo/src/services/reserva.service.ts:21-82`; `reserva.repository.ts:5-18` (11000 → false, sem `any`); `produto.repository.ts:94-126` (`$gte` + `$inc`, compensação, ObjectId inválido sem CastError); `reserva.model.ts:30` (`pedidoId` único); `catalogo/src/index.ts:33-34` (`Reserva.init()` antes do consumer, D23) |
| A4 | Pedidos escuta `estoque.*` e muda o status só a partir de `AGUARDANDO_ESTOQUE` | OK | `pedidos/src/repositories/pedido.repository.ts:88-103` (`updateMany` condicional + `count`); `pedido.service.ts:122-166`; `consumers/estoque.consumer.ts` (pedidoId validado como UUID antes do Prisma) |
| A5 | notificacoes + Mailpit: e-mail de pedido recebido e de sem estoque | OK | `notificacoes/src/services/notificacao.service.ts`, `consumers/eventos.consumer.ts`; sem Express, sem porta, sem rota no Kong |
| A6 | correlationId em todos os eventos e logs | **FALHA** | Eventos OK (repassado do envelope recebido). Logs de publicação/consumo/descarte OK. **Erro de infraestrutura no handler não é logado com correlationId** (ver bloqueante 1) |
| A7 | `.http` com caminho feliz e sem estoque; README com tabela de eventos | OK | `requests/pedidos.http:241-358` (seções 6 e 7, Kafka UI, Mailpit, grep/Select-String); `README.md` seção "📨 Eventos (Kafka)", ADR 007, "⚠️ Limitações conhecidas" (Outbox, DLQ e demais), portas 8090/8025 |

## Checklist — comum
| # | Item | Resultado | Local |
|---|---|---|---|
| 1 | Todas as RN/RF implementadas | FALHA | RF08/RN12 parcial (bloqueante 1). Demais RN01–RN14 e RF01–RF11 OK; D19 aplicada (`pedido.service.ts:56-73`, 409 só para inexistente/inativo) |
| 2 | Rotas, métodos, status e campos idênticos ao contrato | OK | Nenhuma rota nova; `motivo_cancelamento` no `pedidoSelect` (`pedido.repository.ts:12`); schemas de evento idênticos ao contrato §4 nos três `utils/eventos.ts`; interface de `config/kafka.ts` conforme §5 |
| 3 | Critérios de aceite dos planos atendidos | FALHA | Todos OK exceto "Logs de … erro com `[correlationId=<id>]`" |
| 4 | Nenhum `any` / `as any` / `@ts-ignore` em código novo | OK | grep no diff e arquivos novos: nenhum |
| 5 | Toda entrada externa validada (Zod) e env validado | OK | Envelope e `dados` validados com Zod nos três consumers (leitor tolerante, sem `.strict()`); `process.env` só nos `env.ts` |
| 6 | JWT | N/A | Nenhuma mudança de auth; serviços continuam lendo identidade dos cabeçalhos do Kong |
| 7 | Autorização por papel no servidor | N/A | Sem rota nova; `kong/kong.yml` intocado |
| 8 | Erros sem stack/SQL/mensagem do ORM | OK | Nenhum erro HTTP novo; formato `{ erro, detalhes? }` mantido |
| 9 | Sem segredo/credencial versionada ou logada | OK | Evento sem cartão completo/senha/documento (só `cartaoFinal`); nada sensível em log |
| 10 | Fuso | OK | `ocorridoEm` = `toISOString()` (UTC) |
| 11 | Concorrência / sem duplicidade | OK | `$gte` atômico por documento; índice único `reservas.pedidoId`; `updateMany` condicional; corrida de `createTopics` tratada pelo kafkajs (TOPIC_ALREADY_EXISTS → false) |
| 12 | Efeitos externos fora de transação e sem promise solta | OK | Publicação fora da `$transaction` e com `await`; e-mail com `await` |
| 13 | Sem placeholders, código morto ou `console.log` de debug | OK | — |

## Checklist — backend (perfil aulas-ecommerce)
| # | Item | Resultado | Local |
|---|---|---|---|
| 14 | Query com `select` / colunas sensíveis ocultas | OK | `pedidoSelect` explícito; `buscarDisponivel` com `.select("estoque.disponivel")` |
| 15 | Sem N+1 | OK | Um `updateOne` por item na reserva, igual ao slide (aceito no plano) |
| 16 | Tipos compatíveis com o driver | OK | `motivo_cancelamento TEXT NULL` ↔ `String? @db.Text`; Decimal → `.toNumber()` só no evento |
| 17 | Migration | OK | Nova migration manual coerente com o schema; `20261029120000_init` intocada. "down" N/A (Prisma, convenção do projeto) |
| 18 | Camadas (consumer fino → service → repository) | OK | D01 seguida nos três serviços |
| — | Rota no `kong.yml` com tag correta | N/A | Nenhuma rota nova (notificacoes sem API, RN14) |
| — | Serviço validando JWT / identidade fora do gateway | OK | Nada alterado |
| — | Porta publicada além do gateway | OK | Só kafka-ui (8090) e mailpit (8025), exceção da aula registrada no ADR 007 |
| — | Chamada entre serviços sem timeout / pelo gateway | OK | `pedidos/src/catalogo.ts` inalterado; elo novo só por tópico |
| — | FK entre bancos | OK | Nenhuma |
| — | Nenhum serviço importa código de outro | OK | Cada um tem seu `config/kafka.ts` e `utils/eventos.ts` (duplicação intencional) |
| — | SIGTERM / disconnect / exec | OK | `exec node` nos Dockerfiles de pedidos e catalogo; forma exec no de notificacoes; `process.once("SIGTERM")` → `desconectarKafka()` → `process.exit(0)` nos três `index.ts` |
| — | Tipos desconhecidos ignorados | OK | `config/kafka.ts` (`if (!tratar) return`) nos três |
| — | `.http` com caminho feliz, sem estoque e erros | OK | 400, 401, 404, 409, 503 pré-existentes + seções 6/7 (inclui 409 ao cancelar pedido já cancelado) |

## Bloqueantes
### dev-backend
- [ ] `pedidos/src/config/kafka.ts:128-129`, `catalogo/src/config/kafka.ts:128-129`, `notificacoes/src/config/kafka.ts:82-83` — erro de infraestrutura (Postgres/Mongo/Kafka/SMTP) lançado pelo handler sobe sem log próprio; o único registro é o log interno do kafkajs ("Error when calling eachMessage"), **sem `correlationId`**. Contraria o contrato §4 ("Erro de banco/SMTP = log + `throw`"), o plano 2.9/3.10 ("log + throw"), RF08 ("logs de … erro incluem correlationId") e o slide "O QUE ENTREGAR" item 6 ("correlationId em todos os eventos e logs"). Correção esperada: em `iniciarConsumer` dos três serviços, envolver `await tratar(envelope)` em `try/catch` que faça `console.error(\`[correlationId=${envelope.correlationId}] erro ao tratar ${envelope.tipo} pedidoId=${envelope.pedidoId} topico=${topic} offset=${message.offset} (será reentregue):\`, erro)` e **relance** o erro (`throw erro`) para manter o retry do kafkajs.

### dev-frontend
- N/A (sem frontend).

### arquiteto (contrato)
- Nenhum.

## Sugestões (não bloqueantes)
- `pedidos/src/utils/eventos.ts:63` — `motivo` com `.max(500)`: um nome de produto muito longo descartaria o `estoque.insuficiente` e deixaria o pedido parado em `AGUARDANDO_ESTOQUE`. Considerar truncar o motivo no catálogo (`reserva.service.ts:52-55`) ou aceitar e truncar no pedidos.
- `README.md` (Limitações) — a "reserva parcial" cobre queda do catálogo; vale citar também falha ao **publicar** `estoque.*` (Kafka fora depois de `concluirReserva`): a reentrega cai no 11000 e o pedido fica parado.
- `pedidos/src/index.ts:43-44`, `catalogo/src/index.ts:42-51`, `notificacoes/src/index.ts:12-18` — `encerrar` sem `try/catch`: se `disconnect` lançar, vira unhandled rejection (sai com código 1). Envolver em `try/finally` com `process.exit`.
- `docker-compose.yml` (mailpit) — imagem `axllent/mailpit` sem tag (igual ao slide); fixar versão para build reprodutível.
- D04 aceito: com o Kafka fora, o `producer.send` pode segurar o 202 por dezenas de segundos (retry do kafkajs). Opcional: `retry`/`requestTimeout` menores no producer do pedidos.
- `requests/pedidos.http` e `requests/catalogo.http` — linhas `### Extração ...` e `@var ={{...}}` (sem espaço após `=`) vêm das mudanças anteriores à feature; funcionam, só padronizar o espaço.
