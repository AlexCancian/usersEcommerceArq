# Plano backend: kafka-eventos
Data: 29/10/2026
Paralelizável com frontend: N/A — sem frontend (perfil `aulas-ecommerce`).
Paralelização interna: depois da Fase 0 (compose + `notificacoes/package.json`), as Fases 1 (pedidos), 2 (catalogo) e 3 (notificacoes) dependem só do `03-contrato-api.md` e podem andar em paralelo. A Fase 4 (requests/README) vem por último.
Repositórios afetados: **um só** — `usersEcommerceArq` (raiz, um `.git`). Pastas: `docker-compose.yml`, `pedidos/`, `catalogo/`, `notificacoes/` (nova), `requests/pedidos.http`, `README.md`. **Não alterar:** `usuarios/`, `kong/kong.yml`, `.env.example` da raiz.

Regras do CLAUDE.md que valem em todo passo: ESM com imports `.js`, TS strict, sem `any`, `process.env` só em `src/config/env.ts`, npm exclusivamente, Edit em arquivo existente (mostrar Antes/Depois), nunca apagar arquivo, nunca editar migration aplicada. `requests/pedidos.http` e `requests/catalogo.http` têm mudanças **não commitadas**: usar Edit sobre o conteúdo atual, nunca Write.

---

## Banco — `pedidos` (PostgreSQL + Prisma)

`pedidos/prisma/schema.prisma`, model `Pedido` — acrescentar uma linha depois de `cartao_final`:
```prisma
  motivo_cancelamento String?      @db.Text // aula 08: preenchido só por estoque.insuficiente
```

Migration manual (o banco não publica porta; o container aplica com `migrate deploy`):
`pedidos/prisma/migrations/20261029150000_motivo_cancelamento/migration.sql`
```sql
-- AlterTable (aula 08): motivo do cancelamento automático por estoque.insuficiente
ALTER TABLE "pedidos" ADD COLUMN "motivo_cancelamento" TEXT;
```
Não tocar em `20261029120000_init` nem em `migration_lock.toml`.

## Banco — `catalogo` (MongoDB + Mongoose)

Novo model `catalogo/src/models/reserva.model.ts`:
```ts
import { Schema, model } from "mongoose";

export const STATUS_RESERVA = ["processando", "reservado", "insuficiente"] as const;
export type StatusReserva = (typeof STATUS_RESERVA)[number];

export interface IItemReserva {
  produtoId: string;
  quantidade: number;
}

export interface IReserva {
  pedidoId: string;
  itens: IItemReserva[];
  status: StatusReserva;
  criado_em: Date;
  atualizado_em: Date;
}

const ItemReservaSchema = new Schema<IItemReserva>(
  {
    produtoId: { type: String, required: true },
    quantidade: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

// Aula 08, slide "CATALOGO: RESERVAR SEM REPETIR": uma reserva por pedido, pedidoId único.
const ReservaSchema = new Schema<IReserva>(
  {
    pedidoId: { type: String, required: true, unique: true },
    itens: { type: [ItemReservaSchema], required: true },
    status: { type: String, enum: STATUS_RESERVA, required: true, default: "processando" },
  },
  {
    timestamps: { createdAt: "criado_em", updatedAt: "atualizado_em" },
    versionKey: false,
  }
);

export const Reserva = model<IReserva>("Reserva", ReservaSchema, "reservas");
```
Índice único garantido antes do consumer: `await Reserva.init()` no `index.ts` (D23) e `await Reserva.syncIndexes()` no seed.

Coleção existente reaproveitada: `produtos` (`estoque.disponivel`, `estoque.reservado`), sem mudança de schema.

---

## Arquivos (em ordem)

### Fase 0 — Raiz e desbloqueio do hook
| Ordem | Caminho | Ação | Responsabilidade |
|---|---|---|---|
| 0.1 | `notificacoes/package.json` | Criar | **Primeiro arquivo do serviço** (D17: hook passa a liberar escrita em `notificacoes/`). Conteúdo na Fase 3 |
| 0.2 | `docker-compose.yml` | Alterar (Edit) | Blocos abaixo |

Blocos novos do compose (inserir antes de `volumes:`, com comentários de seção no estilo atual):
```yaml
  # ------------------------------------------------------------------- kafka
  # Aula 08: um broker KRaft (broker + controller), fator 1. Sem porta publicada:
  # só a rede interna fala com ele.
  kafka:
    image: apache/kafka:3.8.0
    container_name: ecommerce-kafka
    restart: unless-stopped
    environment:
      CLUSTER_ID: MkU3OEVBNTcwNTJENDM2Qk
      KAFKA_NODE_ID: 1
      KAFKA_PROCESS_ROLES: broker,controller
      KAFKA_LISTENERS: PLAINTEXT://:9092,CONTROLLER://:9093
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092
      KAFKA_CONTROLLER_LISTENER_NAMES: CONTROLLER
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT
      KAFKA_INTER_BROKER_LISTENER_NAME: PLAINTEXT
      KAFKA_CONTROLLER_QUORUM_VOTERS: 1@kafka:9093
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: 1
      KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: 1
      KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS: 0
      KAFKA_NUM_PARTITIONS: 3
      KAFKA_LOG_DIRS: /var/lib/kafka/data
    volumes:
      - kafka_data:/var/lib/kafka/data
    healthcheck:
      test: ["CMD-SHELL", "/opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list || exit 1"]
      interval: 10s
      timeout: 10s
      retries: 10
      start_period: 30s
    networks:
      - ecommerce-net

  # Painel do Kafka (tópicos, mensagens, grupos e lag). Exceção de porta: ADR 007.
  kafka-ui:
    image: kafbat/kafka-ui:v1.1.0
    container_name: ecommerce-kafka-ui
    restart: unless-stopped
    ports:
      - "8090:8080"
    environment:
      KAFKA_CLUSTERS_0_NAME: local
      KAFKA_CLUSTERS_0_BOOTSTRAPSERVERS: kafka:9092
    depends_on:
      kafka:
        condition: service_healthy
    networks:
      - ecommerce-net

  # ------------------------------------------------------------ notificacoes
  # SMTP de mentira: recebe tudo na 1025 (interna) e mostra em localhost:8025. Exceção de porta: ADR 007.
  mailpit:
    image: axllent/mailpit
    container_name: ecommerce-mailpit
    restart: unless-stopped
    ports:
      - "8025:8025"
    networks:
      - ecommerce-net

  # Só escuta eventos: sem banco, sem rota no Kong, sem porta.
  notificacoes:
    build:
      context: ./notificacoes
      dockerfile: Dockerfile
    container_name: ecommerce-notificacoes
    restart: unless-stopped
    stop_grace_period: 10s
    environment:
      NODE_ENV: production
      KAFKA_BROKERS: kafka:9092
      SMTP_HOST: mailpit
      SMTP_PORT: 1025
      MAIL_FROM: "Loja <nao-responda@loja.com>"
    depends_on:
      kafka:
        condition: service_healthy
      mailpit:
        condition: service_started
    networks:
      - ecommerce-net
```
Alterações nos blocos existentes:
- `catalogo`: `stop_grace_period: 10s`; `environment.KAFKA_BROKERS: kafka:9092`; `depends_on` vira forma longa: `mongo-catalogo: { condition: service_started }` e `kafka: { condition: service_healthy }`.
- `pedidos`: `stop_grace_period: 10s`; `environment.KAFKA_BROKERS: kafka:9092`; `depends_on` + `kafka: { condition: service_healthy }` (mantém `postgres-pedidos` healthy e `catalogo` started).
- `volumes:` + `kafka_data:`.
- Comentário do topo: acrescentar que Kafka UI (8090) e Mailpit (8025) também publicam porta (ADR 007).
- `gateway`: sem mudança.

### Fase 1 — `pedidos`
| Ordem | Caminho | Ação | Responsabilidade |
|---|---|---|---|
| 1.1 | `pedidos/package.json` (+ lock) | Alterar via `npm install kafkajs@^2.2.4` (dentro de `pedidos/`) | dependência |
| 1.2 | `pedidos/prisma/schema.prisma` | Alterar | `motivo_cancelamento String? @db.Text` |
| 1.3 | `pedidos/prisma/migrations/20261029150000_motivo_cancelamento/migration.sql` | Criar | `ALTER TABLE` acima |
| 1.4 | `pedidos/src/config/env.ts` | Alterar | `KAFKA_BROKERS: (process.env.KAFKA_BROKERS \|\| "kafka:9092").split(",").map((b) => b.trim()).filter(Boolean)` |
| 1.5 | `pedidos/.env.example` | Alterar | `KAFKA_BROKERS=localhost:9092` (comentário: o Kafka não publica porta; fora do Docker não é suportado) |
| 1.6 | `pedidos/src/utils/eventos.ts` | Criar | Código exato da seção 4.1 do contrato |
| 1.7 | `pedidos/src/config/kafka.ts` | Criar | Interface da seção 5 do contrato: `clientId: "pedidos"`, producer com `createPartitioner: Partitioners.DefaultPartitioner`, `garantirTopicos`, `conectarProducer`, `publicar`, `iniciarConsumer`, `desconectarKafka`. Imports nomeados de `kafkajs` (`Kafka`, `Partitioners`, `logLevel`, tipos `Producer`, `Consumer`, `EachMessagePayload`). `logLevel.WARN` |
| 1.8 | `pedidos/src/repositories/pedido.repository.ts` | Alterar | `pedidoSelect` + `motivo_cancelamento: true`; nova `mudarStatusDoPedido(id, novoStatus, statusOrigem, motivo?)` |
| 1.9 | `pedidos/src/services/pedido.service.ts` | Alterar | (a) **D19**: remover o bloco `if (produto.estoque.disponivel < item.quantidade) {…}` do checkout (mantém inexistente/inativo → 409); (b) publicar `pedido.criado` depois do commit; (c) novos `confirmarEstoqueReservadoService` e `cancelarPorEstoqueInsuficienteService`; (d) atualizar o comentário "na próxima aula, o Kafka o faz andar" |
| 1.10 | `pedidos/src/consumers/estoque.consumer.ts` | Criar | `iniciarConsumerEstoque()`: `iniciarConsumer("pedidos", ["estoque"], handlers)`; handlers validam `pedidoId` (UUID) e `dados` (seção 4.1) e chamam os services |
| 1.11 | `pedidos/src/index.ts` | Alterar | Ciclo de vida (abaixo) |
| 1.12 | `pedidos/Dockerfile` | Alterar | **D20**: `CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/index.js"]` |

Detalhes do 1.9 (checkout):
```text
const correlationId = requestId ?? randomUUID();        // D05 (import { randomUUID } from "node:crypto")
const pedido = await criarPedidoEEsvaziarCarrinho(...); // COMMIT aqui (a transação termina no return)
try {
  await publicar(TOPICOS.PEDIDOS, TIPOS.PEDIDO_CRIADO, pedido.id, {
    usuarioId: usuario.id,
    clienteEmail: usuario.email,
    valorTotal: pedido.valor_total.toNumber(),
    formaPagamento: dados.forma_pagamento,
    cartaoFinal: pedido.cartao_final,
    itens: pedido.itens.map((i) => ({
      produtoId: i.produto_id, nomeProduto: i.nome_produto,
      precoUnitario: i.preco_unitario.toNumber(), quantidade: i.quantidade,
    })),
  } satisfies PedidoCriadoDados, correlationId);
} catch (erro) {
  console.error(`[correlationId=${correlationId}] falha ao publicar pedido.criado pedidoId=${pedido.id} (pedido gravado, ficará em AGUARDANDO_ESTOQUE):`, erro);
}
return pedido;                                           // controller continua respondendo 202 (D04)
```
Services de reação (filtro de estado, RN07):
- `confirmarEstoqueReservadoService(pedidoId, correlationId)` → `mudarStatusDoPedido(pedidoId, AGUARDANDO_PAGAMENTO, [AGUARDANDO_ESTOQUE])`; `count === 0` → log "ignorado (repetido ou status já mudou)", sem erro.
- `cancelarPorEstoqueInsuficienteService(pedidoId, motivo, correlationId)` → `mudarStatusDoPedido(pedidoId, CANCELADO, [AGUARDANDO_ESTOQUE], motivo)`; idem.

Ciclo de vida do `index.ts` (1.11):
```text
async function iniciar() {
  await prisma.$connect();          // banco primeiro
  await garantirTopicos();          // RF06
  await conectarProducer();         // uma vez na subida (slide "KAFKAJS: PUBLICAR")
  await iniciarConsumerEstoque();   // groupId pedidos
  const server = app.listen(PORT, ...);
  const encerrar = async () => {    // RF07
    server.close();
    await desconectarKafka();       // consumer.disconnect() + producer.disconnect()
    await prisma.$disconnect();
    process.exit(0);
  };
  process.once("SIGTERM", encerrar);
  process.once("SIGINT", encerrar);
}
iniciar().catch((erro) => { console.error("Falha ao iniciar o pedidos:", erro); process.exit(1); }); // restart: unless-stopped
export default app;
```

### Fase 2 — `catalogo`
| Ordem | Caminho | Ação | Responsabilidade |
|---|---|---|---|
| 2.1 | `catalogo/package.json` (+ lock) | Alterar via `npm install kafkajs@^2.2.4` | dependência |
| 2.2 | `catalogo/src/config/env.ts` | Alterar | `KAFKA_BROKERS` (mesma regra do 1.4) |
| 2.3 | `catalogo/.env.example` | Alterar | `KAFKA_BROKERS=localhost:9092` + comentário |
| 2.4 | `catalogo/src/models/reserva.model.ts` | Criar | Model acima |
| 2.5 | `catalogo/src/repositories/reserva.repository.ts` | Criar | `criarReserva(pedidoId, itens): Promise<boolean>` (`Reserva.create`; `erro instanceof mongoose.mongo.MongoServerError && erro.code === 11000` → `false`; outro erro → `throw`); `concluirReserva(pedidoId, status)` (`updateOne({ pedidoId }, { $set: { status } })`) |
| 2.6 | `catalogo/src/repositories/produto.repository.ts` | Alterar (acrescentar no fim, sem mexer no legado) | `reservarEstoque(produtoId, qtd): Promise<boolean>`; `devolverEstoque(produtoId, qtd): Promise<void>`; `buscarDisponivel(produtoId): Promise<number \| null>` |
| 2.7 | `catalogo/src/utils/eventos.ts` | Criar | Código exato da seção 4.2 do contrato |
| 2.8 | `catalogo/src/config/kafka.ts` | Criar | Igual ao 1.7 com `clientId: "catalogo"` |
| 2.9 | `catalogo/src/services/reserva.service.ts` | Criar | `reservarEstoqueDoPedidoService(evento, dados)` — algoritmo abaixo |
| 2.10 | `catalogo/src/consumers/pedidos.consumer.ts` | Criar | `iniciarConsumerPedidos()`: `iniciarConsumer("catalogo", ["pedidos"], { "pedido.criado": … })`; valida `dados` (seção 4.2), inválido → log + return |
| 2.11 | `catalogo/src/index.ts` | Alterar | `connectDatabase()` → `await Reserva.init()` (D23) → `garantirTopicos()` → `conectarProducer()` → `iniciarConsumerPedidos()` → `app.listen`; `SIGTERM`/`SIGINT` → `server.close()`, `desconectarKafka()`, `disconnectDatabase()`, `process.exit(0)`; `.catch` → `process.exit(1)` |
| 2.12 | `catalogo/seeds/seed.ts` | Alterar | `await Reserva.syncIndexes()`; novo item em `produtosData` (abaixo); ajustar textos "10 produtos" → "11 produtos" |
| 2.13 | `catalogo/Dockerfile` | Alterar | **D20**: `CMD ["sh", "-c", "npm run seed && exec node dist/index.js"]` |

Queries de estoque (2.6):
```text
reservarEstoque:  if (!mongoose.Types.ObjectId.isValid(produtoId)) return false;   // D06/D08: nada de CastError em loop
                  Produto.updateOne(
                    { _id: produtoId, "estoque.disponivel": { $gte: qtd } },
                    { $inc: { "estoque.disponivel": -qtd, "estoque.reservado": qtd } })
                  → modifiedCount === 1
devolverEstoque:  Produto.updateOne({ _id: produtoId },
                    { $inc: { "estoque.disponivel": qtd, "estoque.reservado": -qtd } })
buscarDisponivel: isValid ? Produto.findById(produtoId).select("estoque.disponivel").lean() → estoque.disponivel | null
```

Algoritmo do 2.9 (slide "CATALOGO: RESERVAR SEM REPETIR"):
```text
1. criou = await criarReserva(pedidoId, itens.map({ produtoId, quantidade }))   // status processando
   if (!criou) { log "[correlationId] evento repetido ignorado pedido.criado pedidoId=…"; return; }   // RN05
2. reservados = []
   for item of dados.itens:
     if (await reservarEstoque(item.produtoId, item.quantidade)) { reservados.push(item); continue; }
     // faltou: devolve o que já tirou (RN03)
     for r of reservados: await devolverEstoque(r.produtoId, r.quantidade)
     disp = await buscarDisponivel(item.produtoId)
     motivo = disp === null
       ? `Produto ${item.nomeProduto} (${item.produtoId}) não encontrado no catálogo.`
       : `Estoque insuficiente para ${item.nomeProduto} (pedido: ${item.quantidade}, disponível: ${disp}).`
     await concluirReserva(pedidoId, "insuficiente")
     await publicar("estoque", "estoque.insuficiente", pedidoId, { motivo, usuarioId, clienteEmail }, correlationId)
     return
3. await concluirReserva(pedidoId, "reservado")
   await publicar("estoque", "estoque.reservado", pedidoId,
                  { usuarioId, clienteEmail, itens: dados.itens, valorTotal, formaPagamento }, correlationId)
```
`correlationId` = o do envelope recebido (RN12). Erro de Mongo/Kafka dentro do handler → log + `throw` (reentrega cai no 11000 e é ignorada: limitação D07).

Novo produto do seed (2.12), idempotente pelo `findOneAndUpdate({ sku }, { $set }, { upsert: true })` existente:
```ts
    {
      sku: "CEL-005",
      nome: "Celular Básico",
      categoria: "celulares",
      preco: 999.9,
      ativo: true,
      atributos: {
        memoria: "32GB",
        cor: "preto",
        tela: "5.5 polegadas",
        conectividade: "4G",
      },
      // Aula 08, slide "TESTANDO O FLUXO": só 2 unidades, para o pedido de 3 dar estoque.insuficiente.
      estoque: { disponivel: 2, reservado: 0 },
    },
```

### Fase 3 — `notificacoes` (serviço novo, TS ESM, sem banco, sem HTTP)
| Ordem | Caminho | Ação | Responsabilidade |
|---|---|---|---|
| 3.1 | `notificacoes/package.json` | Criar (0.1) | abaixo |
| 3.2 | `notificacoes/package-lock.json` | Gerar | dentro de `notificacoes/`: `npm install kafkajs@^2.2.4 nodemailer zod@^3.24.2 dotenv@^16.4.7` e `npm install -D typescript@^5.7.3 tsx@^4.19.3 @types/node@^22.13.4 @types/nodemailer` (o lock é exigido pelo `npm ci` do Dockerfile) |
| 3.3 | `notificacoes/tsconfig.json` | Criar | cópia literal de `pedidos/tsconfig.json` |
| 3.4 | `notificacoes/Dockerfile` | Criar | abaixo |
| 3.5 | `notificacoes/.env.example` | Criar | `NODE_ENV=development`, `KAFKA_BROKERS=localhost:9092`, `SMTP_HOST=localhost`, `SMTP_PORT=1025`, `MAIL_FROM=Loja <nao-responda@loja.com>` |
| 3.6 | `notificacoes/src/config/env.ts` | Criar | `dotenv.config()`; `NODE_ENV`, `KAFKA_BROKERS` (string[]), `SMTP_HOST`, `SMTP_PORT` (parseInt), `MAIL_FROM` com os defaults do contrato §6 |
| 3.7 | `notificacoes/src/utils/eventos.ts` | Criar | Código exato da seção 4.3 do contrato |
| 3.8 | `notificacoes/src/config/kafka.ts` | Criar | `clientId: "notificacoes"`; só `garantirTopicos`, `iniciarConsumer`, `desconectarKafka` (sem producer) |
| 3.9 | `notificacoes/src/config/smtp.ts` | Criar | `nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT, secure: false })` exportado como `smtp` |
| 3.10 | `notificacoes/src/services/notificacao.service.ts` | Criar | `avisarPedidoRecebidoService(evento, dados)` e `avisarSemEstoqueService(evento, dados)` → `smtp.sendMail({ from: env.MAIL_FROM, to: dados.clienteEmail, subject, text })`; log `[correlationId=…] e-mail <assunto> enviado pedidoId=…`; erro SMTP → `throw` (retry) |
| 3.11 | `notificacoes/src/consumers/eventos.consumer.ts` | Criar | `iniciarConsumerEventos()`: `iniciarConsumer("notificacoes", ["pedidos", "estoque"], { "pedido.criado": …, "estoque.insuficiente": … })`; valida `dados` (4.3); `estoque.reservado` e outros: não há handler → ignorado (RN13) |
| 3.12 | `notificacoes/src/index.ts` | Criar | `garantirTopicos()` → `iniciarConsumerEventos()` → log "📨 notificacoes ouvindo pedidos e estoque"; `SIGTERM`/`SIGINT` → `desconectarKafka()`, `smtp.close()`, `process.exit(0)`; `.catch` → `process.exit(1)` |

`notificacoes/package.json` (versões finais preenchidas pelo `npm install` do 3.2):
```json
{
  "name": "notificacoes-service",
  "version": "1.0.0",
  "description": "Microsserviço de Notificações (só escuta eventos do Kafka e envia e-mail) para E-commerce",
  "main": "dist/index.js",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {},
  "devDependencies": {}
}
```

`notificacoes/Dockerfile` (padrão dos vizinhos, sem `openssl`/Prisma, sem `EXPOSE`, D20):
```dockerfile
# Estágio de Build
FROM node:22-slim AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY tsconfig.json ./
COPY src ./src/

RUN npm run build

# Estágio de Produção
FROM node:22-slim AS runner

WORKDIR /app

COPY package*.json ./

# Sem banco, sem seed, sem migration: só as dependências de execução.
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production

# Sem EXPOSE: o serviço não tem HTTP. Forma exec: o Node é o PID 1 e recebe o SIGTERM.
CMD ["node", "dist/index.js"]
```

Textos dos e-mails (D14, PT-BR, `text`, valor com `Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })`):
- `pedido.criado` — assunto **"Recebemos o seu pedido"**; corpo: "Olá! Recebemos o seu pedido <pedidoId>.\n\nItens:\n- <quantidade>x <nomeProduto>\n…\n\nTotal: R$ 2.619,70\n\nAvisaremos quando o pagamento for confirmado."
- `estoque.insuficiente` — assunto **"Seu pedido foi cancelado: produto sem estoque"**; corpo: "Olá! Infelizmente o pedido <pedidoId> foi cancelado.\n\nMotivo: <motivo>\n\nNenhum valor foi cobrado."

### Fase 4 — Testes e documentação
| Ordem | Caminho | Ação | Responsabilidade |
|---|---|---|---|
| 4.1 | `requests/pedidos.http` | Alterar (**Edit**, há mudanças sem commit) | Seções 6 e 7 no fim + atualizar o cabeçalho (fluxo agora termina em `AGUARDANDO_PAGAMENTO`/`CANCELADO`) |
| 4.2 | `README.md` | Alterar (Edit) | itens abaixo |

Conteúdo do 4.1 (acrescentar depois da seção 5; reaproveita `tokenCliente`, `produtoA` e `@baseUrl`):
- Bloco de instruções: Kafka UI `http://localhost:8090` (tópicos `pedidos`/`estoque`, mesma key = id do pedido, grupos e lag), Mailpit `http://localhost:8025` (os dois e-mails), `docker compose logs pedidos catalogo notificacoes | grep <correlationId>` (o `correlationId` é o header `X-Request-Id` devolvido pelo Kong na resposta do checkout; no PowerShell: `docker compose logs pedidos catalogo notificacoes | Select-String <id>`).
- **6. Caminho feliz (aula 08)**:
  - 6.1 `GET {{baseUrl}}/produtos/{{produtoA}}` — anotar `estoque.disponivel` e `estoque.reservado` antes.
  - 6.2 `POST /carrinho/itens` com `produtoA`, quantidade 1 (201).
  - 6.3 `# @name checkoutEvento` `POST /pedidos` com `forma_pagamento: "pix"` → **202** `AGUARDANDO_ESTOQUE`, `motivo_cancelamento: null`. `@pedidoEvento = {{checkoutEvento.response.body.id}}`.
  - 6.4 `GET /pedidos/{{pedidoEvento}}` — "reenvie até mudar": **200** `AGUARDANDO_PAGAMENTO`.
  - 6.5 `GET /produtos/{{produtoA}}` — `disponivel` diminuiu e `reservado` aumentou na quantidade do pedido (inclui o item que sobrou no carrinho da seção 5, se houver).
  - 6.6 Mailpit: e-mail "Recebemos o seu pedido".
- **7. Sem estoque (aula 08)**:
  - 7.1 `# @name celularBasico` `GET /produtos?ids=CEL-005` → `@produtoSemEstoque = {{celularBasico.response.body.$[0]._id}}` (`estoque.disponivel` = 2).
  - 7.2 `POST /carrinho/itens` com `produtoSemEstoque`, quantidade **3** (201; o carrinho não confere estoque).
  - 7.3 `# @name checkoutSemEstoque` `POST /pedidos` → **202** `AGUARDANDO_ESTOQUE` (D19: o checkout não recusa mais por estoque).
  - 7.4 `GET /pedidos/{{checkoutSemEstoque.response.body.id}}` — reenvie até mudar: **200** `CANCELADO`, `motivo_cancelamento` = "Estoque insuficiente para Celular Básico (pedido: 3, disponível: 2)."
  - 7.5 `GET /produtos/{{produtoSemEstoque}}` — estoque inalterado (`disponivel` 2, `reservado` 0): tudo ou nada.
  - 7.6 `POST /pedidos/{{…}}/cancelar` no pedido cancelado → **409** (status `CANCELADO` não permite).
  - 7.7 Mailpit: "Recebemos o seu pedido" + "Seu pedido foi cancelado: produto sem estoque".
  - 7.8 (opcional, "notificações fora, a loja continua"): `docker compose stop notificacoes` → repetir 7.2–7.4 (pedido cancela normalmente) → `docker compose start notificacoes` → os e-mails pendentes chegam (o grupo continua do offset).

Conteúdo do 4.2 (README):
- Topo: linha "**Aula 08:** Kafka (KRaft) e eventos: checkout publica, catálogo reserva, notificações avisa (coreografia)".
- Diagrama "Arquitetura": Kafka na rede interna com `pedidos → [pedidos] → catalogo → [estoque] → pedidos`, `notificacoes` ouvindo os dois; `mailpit`.
- "Estrutura": `notificacoes/` (Express não, só consumer + nodemailer), `src/config/kafka.ts`, `src/consumers/`, `src/utils/eventos.ts` em cada serviço; `docker-compose.yml` com kafka, kafka-ui, mailpit, notificacoes.
- "Como Executar": lista de containers atualizada; tabela de portas + `8090` Kafka UI e `8025` Mailpit.
- Rotas de Pedidos: `POST /pedidos` → "202 aceito (publica `pedido.criado`) · 400 carrinho vazio · 409 produto inexistente ou inativo · 503 catálogo fora"; `GET /pedidos/:id` → menciona `motivo_cancelamento` e mudança de status por evento.
- Nova seção **"📨 Eventos (Kafka)"**: tabela Evento | Tópico | Publica | Consome | `dados`; envelope; chave = id do pedido; group ids; 3 partições; ciclo de status (`AGUARDANDO_ESTOQUE` → `AGUARDANDO_PAGAMENTO` | `CANCELADO`).
- Seeds: catálogo com 11 produtos, incluindo `CEL-005` "Celular Básico" com 2 unidades.
- Testes: `pedidos.http` com caminho feliz por eventos e sem estoque.
- ADR 006: trocar "quem o faz andar é o Kafka, na próxima aula" por "quem o faz andar são os eventos (ADR 007)".
- **ADR 007: Kafka e coreografia por eventos** — Decisão: um broker Kafka 3.8 KRaft (fator 1), tópicos por entidade (`pedidos`, `estoque`, 3 partições), envelope único, chave = id do pedido, `correlationId` = `X-Request-Id`; coreografia (ninguém orquestra); publicação depois do commit; idempotência por chave única (`reservas.pedidoId`) e por filtro de estado (`updateMany` a partir de `AGUARDANDO_ESTOQUE`); `notificacoes` só escuta. Consequências: consistência eventual (cliente consulta o status); Kafka UI (8090) e Mailpit (8025) publicam porta sem autenticação, só para uso local — exceção à regra "só o gateway publica portas"; checkout não recusa mais por estoque (decisão do catálogo).
- Nova seção **"⚠️ Limitações conhecidas"**: escrita dupla (sem Outbox), mensagem venenosa descartada (sem DLQ), reserva parcial se o catálogo cair entre o insert em `reservas` e o fim, cancelamento manual não devolve estoque (aula 09), `fromBeginning` reenvia e-mails para grupo novo, e-mail duplicado em reentrega, seed do catálogo repõe `estoque` a cada subida do container, Kafka UI/Mailpit sem autenticação.

---

## Queries previstas
| Função | Entidade/Modelo | Operação | Colunas/campos retornados | Transação/lock |
|---|---|---|---|---|
| `criarPedidoEEsvaziarCarrinho` (existente) | `pedidos`, `itens_pedido`, `carrinho_itens` | create + deleteMany | `pedidoSelect` (+ `motivo_cancelamento`) | `prisma.$transaction`; publicação **depois** do retorno |
| `mudarStatusDoPedido` (nova) | `pedidos` | `updateMany({ where: { id, status: { in: statusOrigem } }, data: { status, motivo_cancelamento? } })` | `count` | update condicional atômico (filtro de estado) |
| `listarPedidosDoUsuario` / `buscarPedidoDoUsuario` / `cancelarPedidoDoUsuario` (existentes) | `pedidos` | inalteradas | `pedidoSelect` + `motivo_cancelamento` | — |
| `criarReserva` (nova) | `reservas` | `create` | — (`boolean`: criou?) | índice único `pedidoId` (11000 = repetido) |
| `concluirReserva` (nova) | `reservas` | `updateOne({ pedidoId }, { $set: { status } })` | — | — |
| `reservarEstoque` (nova) | `produtos` | `updateOne` com `$gte` + `$inc` | `modifiedCount` | atômico por documento (RN06) |
| `devolverEstoque` (nova) | `produtos` | `updateOne` com `$inc` inverso | — | compensação, só dos já reservados |
| `buscarDisponivel` (nova) | `produtos` | `findById().select("estoque.disponivel").lean()` | `estoque.disponivel` | só no caminho de falha |

Sem N+1 fora do previsto pela aula: a reserva faz um `updateOne` por item (o slide usa o mesmo laço; poucos itens por pedido).

## Concorrência e efeitos colaterais
- Dois pedidos simultâneos do mesmo produto: o `$gte` no filtro garante que só um tira as últimas unidades; o outro recebe `modifiedCount = 0` → insuficiente (RN06).
- Mesmo `pedido.criado` duas vezes (reentrega, rebalance, replay): o segundo `create` em `reservas` dá 11000 → ignorado (RN05).
- `estoque.*` repetido ou atrasado: `updateMany` só a partir de `AGUARDANDO_ESTOQUE` → `count 0` → ignorado; cancelamento manual concorrente vence sem conflito (RN07/RN08).
- Ordem por pedido: chave = `pedidoId` → mesma partição. Entre tópicos, a ordem vem da causa e efeito.
- Efeitos colaterais fora de transação: publicação pós-commit (D04) e e-mail (D14) — limitações documentadas.

## Integração entre serviços
1. Nenhum serviço importa código de outro; o único elo novo é o tópico. `pedidos → catalogo` HTTP síncrono (preço) continua igual.
2. Ordem de subida: `kafka` healthy → `catalogo`, `pedidos`, `notificacoes`, `kafka-ui`. Cada um chama `garantirTopicos()` (quem chegar primeiro cria; "já existe" não é erro).
3. Migration nova de `pedidos` aplicada pelo `migrate deploy` do container. Nada é desligado.
4. Kong: nenhuma alteração; `correlation-id` global já existe.

## Dependências novas
| Pacote | Versão | Serviço | Motivo |
|---|---|---|---|
| `kafkajs` | ^2.2.4 | pedidos, catalogo, notificacoes | cliente Kafka (tipos próprios) |
| `nodemailer` | atual do `npm install` | notificacoes | SMTP para o Mailpit |
| `@types/nodemailer` | atual do `npm install` (dev) | notificacoes | tipos |
| `zod` ^3.24.2, `dotenv` ^16.4.7 | | notificacoes | mesmo padrão dos vizinhos |
| `typescript` ^5.7.3, `tsx` ^4.19.3, `@types/node` ^22.13.4 | (dev) | notificacoes | build/dev |

## Variáveis de ambiente novas
| Nome | Validação | Exemplo | Serviço |
|---|---|---|---|
| `KAFKA_BROKERS` | `split(",")` → `string[]` não vazio, default `kafka:9092` | `kafka:9092` | pedidos, catalogo, notificacoes |
| `SMTP_HOST` | texto, default `mailpit` | `mailpit` | notificacoes |
| `SMTP_PORT` | `parseInt`, default `1025` | `1025` | notificacoes |
| `MAIL_FROM` | texto, default `Loja <nao-responda@loja.com>` | idem | notificacoes |

## Verificação (npm/npx, dentro de cada pasta alterada — CLAUDE.md)
| Onde | Comandos |
|---|---|
| `pedidos/` | `npx prisma validate` · `npx prisma generate` · `npx tsc --noEmit` · `npm run build` |
| `catalogo/` | `npx tsc --noEmit` · `npm run build` (o `seeds/` fica fora do `tsconfig`; conferir o seed por leitura) |
| `notificacoes/` | `npx tsc --noEmit` · `npm run build` |
| raiz | `docker compose config --quiet` |

Pendência para o usuário (salvo pedido explícito): `docker compose up -d --build` e rodar as seções 6 e 7 do `requests/pedidos.http`, conferindo Kafka UI (8090), Mailpit (8025) e `docker compose logs | grep <correlationId>`.

## Critérios de aceite
- [ ] `docker compose config --quiet` sem erro; só `gateway` (8080/8001/8002), `kafka-ui` (8090) e `mailpit` (8025) têm `ports:` (RF01).
- [ ] `kafka` com healthcheck, volume `kafka_data` + `KAFKA_LOG_DIRS`; `pedidos`, `catalogo`, `notificacoes` com `depends_on: kafka: service_healthy` e `stop_grace_period: 10s` (RF01).
- [ ] `POST /pedidos` responde 202 `AGUARDANDO_ESTOQUE` e publica `pedido.criado` só depois do commit, key = id do pedido, envelope completo, sem número de cartão (RF02, RN02, RN10).
- [ ] Kafka fora no momento da publicação → ainda 202 e log de erro com `[correlationId=…]` (D04).
- [ ] Checkout não devolve mais 409 por estoque; continua 409 para produto inexistente/inativo (D19).
- [ ] `catalogo` grava `reservas` (`pedidoId` único, `status` processando → reservado/insuficiente), reserva com `$gte`/`$inc`, compensa os itens já reservados e publica `estoque.*` com o mesmo `correlationId` (RF03, RN03–RN06).
- [ ] Reprocessar o mesmo `pedido.criado` não altera estoque nem publica de novo (RN05).
- [ ] `pedidos` muda para `AGUARDANDO_PAGAMENTO`/`CANCELADO` só a partir de `AGUARDANDO_ESTOQUE`; `motivo_cancelamento` gravado e exposto (RF04, RN07).
- [ ] `notificacoes` envia "Recebemos o seu pedido" e o e-mail de sem estoque para `dados.clienteEmail` via `mailpit:1025`; ignora outros tipos (RF05).
- [ ] Tópicos `pedidos`/`estoque` com 3 partições criados por `listTopics` + `createTopics` (RF06).
- [ ] `SIGTERM` desconecta consumer e producer (Node é PID 1 via `exec`/forma exec) (RF07, D20).
- [ ] Logs de publicação, consumo, descarte e erro com `[correlationId=<id>]` (RF08).
- [ ] `requests/pedidos.http` com seções 6 (caminho feliz) e 7 (sem estoque → CANCELADO com motivo, estoque intacto) e instruções de Kafka UI/Mailpit/grep (RF09).
- [ ] README com tabela de eventos, ADR 007, limitações (Outbox, DLQ e demais), portas 8090/8025 e `notificacoes/` na estrutura (RF10).
- [ ] Seed com `CEL-005` "Celular Básico" (`disponivel` 2), idempotente (RF11).
- [ ] Nenhum `any` novo; nenhum import entre serviços; `process.env` só nos `env.ts`; `kong/kong.yml` e `usuarios/` intocados.
- [ ] Comandos de verificação acima passam em `pedidos/`, `catalogo/` e `notificacoes/`.
