# Validação da spec: kafka-eventos
Data: 29/10/2026
Veredito: APROVADA (com as decisões de arquitetura D19–D25 abaixo, obrigatórias para o dev-backend)

Perfil: `aulas-ecommerce` (CLAUDE.md da raiz). Fonte da verdade: `aulas/texto/08-kafka-e-eventos.txt`.

| Item | Resultado | Observação |
|---|---|---|
| Spec com Status PRONTA | OK | Sem perguntas em aberto |
| Toda RN coberta por RF | OK | RN01→RF02 · RN02→RF02 · RN03/RN04/RN05/RN06→RF03 · RN07→RF04 · RN08→(sem mudança, RF04 não altera o cancelar) · RN09→RF02/RF03 · RN10→RF02 · RN11→RF01/RF03/RF04/RF05 · RN12→RF02/RF08 · RN13→RF05/D22 · RN14→RF01/RF05 |
| Todo RF com critério verificável | OK (após D19) | RF09 "sem estoque → CANCELADO" só é verificável com D19 (sem D19 o checkout devolve 409 antes de publicar) |
| Tipos compatíveis com driver(s) alvo | OK | `motivo_cancelamento TEXT NULL` (`String? @db.Text`); `reservas` Mongoose com `pedidoId: String` único; `valorTotal`/`precoUnitario` como `number` no evento a partir de `Decimal(12,2)` (`.toNumber()`, sem perda até 2^53) |
| Sem conflito com código existente | OK (após D19, D20) | Ver "Conflitos encontrados" |
| Segurança explícita (papéis, dados sensíveis) | OK | Nenhuma rota nova (Kong intocado); Kafka PLAINTEXT sem porta; evento sem cartão completo/senha/documento (só `cartaoFinal`); `clienteEmail` no evento por decisão da aula; Kafka UI (8090) e Mailpit (8025) sem autenticação, uso local (ADR 007) |
| Concorrência | OK | Reserva: `updateOne` com `$gte` no filtro + `$inc` (atômico por documento) e índice único `reservas.pedidoId`; status: `updateMany` condicional + `count`; chave = `pedidoId` |
| Fuso | OK | `ocorridoEm` ISO 8601 UTC (`toISOString()`); colunas `Timestamptz` |

## Conflitos encontrados no código (não cobertos pela spec)
1. **Checkout recusa por estoque de forma síncrona** — `pedidos/src/services/pedido.service.ts` (laço do checkout) lança `ConflictError` quando `produto.estoque.disponivel < item.quantidade`. Com isso o cenário da aula (slide "TESTANDO O FLUXO": "3 unidades do Celular Básico (o seed tem 2): CANCELADO, com o motivo") devolve 409 e nunca publica `pedido.criado`. → **D19**.
2. **SIGTERM não chega ao Node** — `pedidos/Dockerfile` e `catalogo/Dockerfile` usam `CMD ["sh", "-c", "... && node dist/index.js"]`: o PID 1 é o `sh`, que não repassa o sinal; o `process.once("SIGTERM")` exigido por RF07 nunca dispara e o container morre por SIGKILL após o grace period. → **D20**.
3. **Índice único criado de forma assíncrona** — Mongoose cria índices em background ao registrar o model; se o primeiro `pedido.criado` chegar antes do índice de `reservas.pedidoId` existir, a idempotência (RN05) falha. → **D23**.
4. **Volume do Kafka** — a imagem `apache/kafka` grava por padrão em `/tmp/kraft-combined-logs`; montar `kafka_data` em `/var/lib/kafka/data` (D10) sem `KAFKA_LOG_DIRS` não persiste nada. → **D24**.

## Revisão das decisões D01–D18
| Decisão | Resultado | Observação do arquiteto |
|---|---|---|
| D01 camadas para consumers | OK | Nomes finais: `src/consumers/<topico>.consumer.ts`, regra em `src/services/*.service.ts`, envelope/schemas de evento em `src/utils/eventos.ts` (separado de `src/utils/schemas.ts`, que fica só para HTTP no formato `{ body, query, params }`), infra em `src/config/kafka.ts` |
| D02 itens camelCase, valores numéricos | OK | Envelope é camelCase na aula; HTTP continua snake_case. Mapeamento só no service de `pedidos` ao montar o evento |
| D03 origem de `clienteEmail`/`usuarioId`/`cartaoFinal` | OK | `cartaoFinal` `null` em pix/boleto |
| D04 202 mesmo com falha do Kafka pós-commit | OK | O pedido existe e o carrinho foi esvaziado; 503 seria mentira. Log `console.error` com `[correlationId=…]` e `pedidoId` para reprocesso manual. É a "escrita dupla" do slide "AS ARMADILHAS" (Outbox = limitação no README). A latência do 202 pode subir alguns segundos enquanto o kafkajs esgota o retry do producer — aceito |
| D05 `correlationId` ausente → `randomUUID()` | OK | Gerado uma vez no service do checkout e usado também nos logs |
| D06 descarte sem DLQ de mensagem inválida | OK, com ressalva | Ressalva obrigatória: campos que viram filtro de banco precisam ser validados antes do banco para não virar erro de infraestrutura em loop: em `pedidos`, `pedidoId` deve ser UUID (senão o Prisma lança P2023 a cada retry); em `catalogo`, `produtoId` inválido para ObjectId vira "insuficiente" (D08) sem chamar o Mongo com ele (senão `CastError` em loop). Erro de validação = log + `return`; erro de infraestrutura = log + `throw` |
| D07 `reservas.status` nasce `processando` | OK | Igual à aula. Alternativa rejeitada: ao receber 11000 com status final, republicar o `estoque.*` (resolveria falha de publicação, mas diverge do slide e repete e-mails num replay). Reserva parcial e evento não publicado ficam como limitação documentada |
| D08 produto inexistente/`_id` inválido/sem estoque = insuficiente | OK | `ativo` fora do filtro, como na aula. Motivo legível; `disponivel` lido com um `findById` só no caminho de falha |
| D09 env do Kafka | OK + D24 | Acrescentar `KAFKA_LOG_DIRS` e `CLUSTER_ID` fixo |
| D10 volume `kafka_data` | OK, condicionado a D24 | Sem ele, `fromBeginning: true` reprocessaria tudo a cada `down`/`up` |
| D11 kafka-ui/mailpit/notificacoes no compose | OK | Mailpit 1025 só interno; kafka-ui com `depends_on: kafka: service_healthy` |
| D12 `.env.example` | OK | Raiz sem variável nova; `KAFKA_BROKERS` nos `.env.example` de `pedidos`/`catalogo`; `notificacoes/.env.example` novo |
| D13 `motivo_cancelamento` nas respostas | OK | Atenção: o campo entra no `pedidoSelect`, logo aparece em **todas** as respostas que devolvem pedido (`POST /pedidos` 202, `GET /pedidos`, `GET /pedidos/:id`, `POST /pedidos/:id/cancelar`) com `null` quando não houver. Mudança aditiva |
| D14 e-mail duplicado possível | OK | Aceito pela aula (slide "GARANTIAS DE ENTREGA") |
| D15 README/ADR 007 | OK | Último ADR existente é o 006 |
| D16 dependências | OK | `kafkajs` ^2.2.4 (tipos próprios); `nodemailer` + `@types/nodemailer` versão atual pelo `npm install` |
| D17 `notificacoes/package.json` cedo | OK | Primeiro arquivo do serviço no plano |
| D18 tag/commit fora do escopo | OK | — |

## Decisões novas do arquiteto
- **D19 — Checkout deixa de recusar por estoque (aula vence o código).** O laço do `checkoutService` mantém o 409 para produto inexistente/inativo, mas **remove** a checagem `estoque.disponivel < quantidade`. Quem decide estoque passa a ser o catálogo, por evento (RN03; slide "PEDIDOS: PUBLICAR E ESCUTAR": "A consulta síncrona ao catálogo continua: o preço precisa ser o de agora"). A mensagem do 409 continua "Produto indisponível." com `detalhes`. `GET /carrinho` continua mostrando `disponivel` (informativo). README: linha do `POST /pedidos` passa a "409 produto inexistente ou inativo".
- **D20 — `exec` no `CMD`.** `pedidos`: `CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/index.js"]`; `catalogo`: `CMD ["sh", "-c", "npm run seed && exec node dist/index.js"]`; `notificacoes`: forma exec `CMD ["node", "dist/index.js"]`. Assim o Node é o PID 1 e recebe o SIGTERM (RF07). O handler termina com `process.exit(0)`.
- **D21 — `fromBeginning: true` nos três grupos** (`pedidos`, `catalogo`, `notificacoes`). Só vale para grupo sem offset; com `kafka_data` persistido acontece uma vez. Evita perder evento publicado antes do primeiro `join` do grupo; o custo (e-mails repetidos num grupo novo) já está nas limitações.
- **D22 — Leitor tolerante.** Cada consumer valida com Zod **só os campos que usa** (objetos sem `.strict()`: campo novo não quebra, RN13). `tipo` desconhecido é ignorado antes de validar `dados`.
- **D23 — Índices antes do consumer.** `catalogo/src/index.ts` chama `await Reserva.init()` (garante o índice único) depois de conectar o Mongo e antes de iniciar o consumer; o seed também chama `Reserva.syncIndexes()` como já faz com `Produto`/`Categoria`.
- **D24 — Kafka persistente.** `KAFKA_LOG_DIRS: /var/lib/kafka/data` + `CLUSTER_ID: MkU3OEVBNTcwNTJENDM2Qk` (fixo, para o volume continuar válido entre recriações do container).
- **D25 — Particionador.** Producers com `createPartitioner: Partitioners.DefaultPartitioner` (murmur2, compatível com o cliente Java e sem o aviso do kafkajs v2). Garante `hash(pedidoId) % 3` estável.

## Riscos aceitos (não bloqueiam)
- O seed do catálogo faz `$set` do produto inteiro (inclusive `estoque`) a cada subida do container: reiniciar o `catalogo` zera `reservado` e repõe `disponivel`, ficando incoerente com `reservas`. Comportamento pré-existente, mantido pela spec; registrar em "Limitações" do README.
- Kafka UI expõe o conteúdo dos eventos (e-mails de clientes) na 8090 sem autenticação — uso local/didático (ADR 007).

## Motivos da reprovação
- Não se aplica.
