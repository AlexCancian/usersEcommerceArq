# E-Commerce - Arquitetura de Microsserviços

Repositório estruturado no modelo de **monorepo com microsserviços independentes**. Cada serviço possui sua própria stack, dependências (`package.json`), banco de dados isolado e `Dockerfile`.

- **Aula 06:** `usuarios` (Postgres) e `catalogo` (MongoDB) no Docker Compose.
- **Aula 07:** API Gateway (Kong) na frente de tudo, JWT validado no gateway e o serviço `pedidos` (carrinho e checkout) consultando o catálogo.
- **Aula 08:** Kafka (KRaft) e eventos: o checkout publica, o catálogo reserva o estoque e as notificações avisam por e-mail (coreografia).
- **Aula 09:** Saga e resiliência: o serviço `pagamentos` cobra no `banco-falso` (timeout, retry e circuit breaker) e cada serviço desfaz a própria parte quando o pagamento é recusado ou o pedido é cancelado (compensações).

---

## 🏗️ Arquitetura

```text
Cliente (REST Client / Postman)
        │  Authorization: Bearer <JWT>
        ▼
┌──────────────────────────────┐
│  KONG :8080 (único exposto)  │  correlation-id · apaga X-User-* · jwt (401) · acl (403)
│                              │  injeta X-User-Id / X-User-Email / X-User-Role · rate-limit no login
└──────────────┬───────────────┘
               │ rede interna do Docker (ecommerce-net): ninguém de fora alcança
     ┌─────────┼──────────────┬──────────────────┐
     ▼         ▼              ▼                  ▼
 usuarios   catalogo  ◄──── pedidos          pagamentos ──HTTP──► banco-falso (:9000, fora do Kong)
 Postgres   MongoDB         Postgres         Postgres      timeout 2 s · retry 3× · circuit breaker

 (pedidos → catalogo: chamada direta, sem gateway, timeout 3 s)

Eventos (Kafka, só na rede interna; tópicos pedidos, estoque e pagamentos, 3 partições, chave = id do pedido):

 pedidos ──pedido.criado / pedido.cancelado──► [pedidos] ──► catalogo, pagamentos, notificacoes
 catalogo ──estoque.reservado / estoque.insuficiente──► [estoque] ──► pedidos, pagamentos, notificacoes
 pagamentos ──pagamento.aprovado / recusado / estornado──► [pagamentos] ──► pedidos, catalogo, notificacoes
                                                          notificacoes ──SMTP──► mailpit (:8025)
```

- **Gateway decide a porta:** quem é você (401) e se pode entrar na rota de admin (403).
- **Serviço decide o recurso:** este pedido/endereço é seu? (404) Ainda pode ser cancelado? (409)
- **`usuarios` é o único que emite JWT** (HS256, `{ sub, email, perfil, iss }`, vence em 2 h). Os serviços não validam token: leem os cabeçalhos `X-User-*` que o Kong injeta.

---

## 📁 Estrutura do Repositório

```text
usersEcommerceArq/
├── docker-compose.yml          # gateway + 5 serviços + 4 bancos + banco-falso, kafka, kafka-ui e mailpit
├── .env.example                # JWT_SECRET compartilhado por usuarios e gateway
├── kong/
│   └── kong.yml                # Kong sem banco: services, routes, consumers e plugins
├── usuarios/                   # Express + Prisma + PostgreSQL (emite o JWT)
├── catalogo/                   # Express + Mongoose + MongoDB (+ consumer pedidos.consumer.ts e coleção reservas)
├── pedidos/                    # Express + Prisma + PostgreSQL (carrinho e checkout)
│   ├── prisma/schema.prisma    # carrinho_itens, pedidos, itens_pedido
│   └── src/
│       ├── catalogo.ts         # chamada síncrona ao catálogo (timeout 3 s → 503)
│       ├── middleware/auth.ts  # lê X-User-* injetados pelo gateway
│       ├── repositories/ services/ controllers/ routes/
│       ├── consumers/          # estoque.consumer.ts (estoque.*) e pagamentos.consumer.ts (pagamento.*)
│       ├── config/kafka.ts     # producer, consumer e criação dos tópicos
│       ├── utils/eventos.ts    # envelope e schemas Zod dos eventos
│       └── index.ts
├── pagamentos/                 # Express + Prisma + PostgreSQL (aula 09: a cobrança na saga)
│   ├── prisma/schema.prisma    # pagamentos (pedido_id UNIQUE = idempotência)
│   └── src/
│       ├── banco.ts            # chamada ao banco: timeout 2 s, retry 3× com backoff, circuit breaker (opossum)
│       ├── consumers/          # estoque.reservado → cobra · pedido.cancelado → bloqueia ou estorna
│       └── repositories/ services/ controllers/ routes/ config/ utils/
├── banco-falso/                # Express sem banco: o banco do cartão (sistema externo), latência e falhas por /config
├── notificacoes/               # só consumer Kafka + nodemailer (sem Express, sem banco, sem rota no Kong)
│   └── src/ config/ consumers/ services/ utils/
└── requests/
    ├── usuarios.http
    ├── catalogo.http
    ├── pedidos.http
    ├── pagamentos.http         # rotas de pagamentos (200, 401, 403, 404)
    ├── fluxo-compra.http       # a saga: aprovada, recusada (0002) e cancelada com estorno
    └── demos.http              # resiliência: falhaPercent 30/100 e latenciaMs 3000 no banco-falso
```

Cada serviço segue as camadas `controllers → services → repositories` (ADR 001) e escuta na **porta 3000 dentro do container**.

---

## 🚀 Como Executar

```bash
cp .env.example .env          # opcional: troca o JWT_SECRET
docker compose up --build
```

Sobem: `gateway` (Kong), `usuarios`, `catalogo`, `pedidos`, `pagamentos`, `notificacoes`, `postgres-usuarios`, `mongo-catalogo`, `postgres-pedidos`, `postgres-pagamentos`, `banco-falso`, `kafka`, `kafka-ui` e `mailpit`.
Os serviços esperam o Kafka ficar saudável (`depends_on` com `service_healthy`).
Cada container de serviço roda as próprias migrations e seeds idempotentes ao iniciar (os bancos não publicam porta).

| Porta | O que é |
| :--- | :--- |
| `8080` | **API da loja** (única URL usada pelos clientes) |
| `8001` | Admin API do Kong (leitura: `curl localhost:8001/routes`) |
| `8002` | Kong Manager (painel) |
| `8090` | Kafka UI (tópicos, mensagens, grupos e lag): só para uso local, sem autenticação |
| `8025` | Mailpit (caixa de entrada dos e-mails de mentira): só para uso local, sem autenticação |
| `9000` | banco-falso (o banco do cartão, sistema externo): `GET/POST /config` para latência e falhas ao vivo. Fora do Kong (ADR 009) |

Mudou o `kong/kong.yml`? `docker compose restart gateway`.

---

## 📌 Rotas pelo Gateway (`http://localhost:8080`)

### Usuários
| Método | Rota | Acesso | No Kong | Sem permissão |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/auth/login` | público | rate-limiting (10/min por IP) | 429 na 11ª tentativa |
| `POST` | `/usuarios` | público | — | — |
| `GET` · `PUT` | `/usuarios/me` | logado | jwt | 401 |
| `GET` · `POST` | `/usuarios/me/enderecos` | logado | jwt | 401 |
| `DELETE` | `/usuarios/me/enderecos/:id` | logado | jwt | 401 · 404 se o endereço não é seu |
| `GET` | `/usuarios` | admin | jwt + acl allow [admin] | 401 · 403 perfil cliente |
| `GET` | `/health/usuarios` | público | — | — |

### Catálogo
| Método | Rota | Acesso | No Kong | Sem permissão |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/produtos?categoria=&busca=&ids=` | público | — | — |
| `GET` | `/produtos/:id` | público | — | — |
| `GET` | `/categorias` | público | — | — |
| `POST` | `/produtos` | admin | jwt + acl allow [admin] | 401 · 403 |
| `PUT` | `/produtos/:id` | admin | jwt + acl allow [admin] | 401 · 403 |
| `PATCH` | `/produtos/:id/estoque` | admin | jwt + acl allow [admin] | 401 · 403 |
| `DELETE` | `/produtos/:id` | admin | jwt + acl allow [admin] | 401 · 403 |
| `POST` | `/categorias` | admin | jwt + acl allow [admin] | 401 · 403 |
| `GET` | `/health/catalogo` | público | — | — |

### Pedidos
| Método | Rota | Acesso | Retornos |
| :--- | :--- | :--- | :--- |
| `GET` | `/carrinho` | logado | 200 `{ itens, total }` com preços atuais do catálogo |
| `POST` | `/carrinho/itens` | logado | 201 · 400 quantidade inválida · 404 produto não existe |
| `DELETE` | `/carrinho/itens/:produtoId` | logado | 204 · 404 não está no carrinho |
| `POST` | `/pedidos` | logado | 202 aceito (publica `pedido.criado`) · 400 carrinho vazio · 409 produto inexistente ou inativo · 503 catálogo fora |
| `GET` | `/pedidos` | logado | 200 meus pedidos (cada um com `motivo_cancelamento`, `null` se não houver) |
| `GET` | `/pedidos/:id` | logado | 200 pedido com itens e `motivo_cancelamento` (o status muda sozinho por evento) · 404 não existe ou não é meu |
| `POST` | `/pedidos/:id/cancelar` | logado | 200 cancelado (publica `pedido.cancelado`: estoque volta, pagamento estornado ou bloqueado) · 404 não é meu · 409 status não permite (ex.: `PAGO`) |
| `GET` | `/health/pedidos` | público | 200 serviço e banco ok |

### Pagamentos (aula 09)
| Método | Rota | Acesso | No Kong | Retornos |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/pagamentos/:pedidoId` | logado | jwt | 200 pagamento (dono ou admin) · 401 · 404 não existe ou não é seu |
| `GET` | `/pagamentos` | admin | jwt + acl allow [admin] | 200 todos · 401 · 403 perfil cliente |
| `GET` | `/health/pagamentos` | público | — | 200 `{ status, banco, circuitoBancoExterno: fechado \| aberto \| meio-aberto }` |

O pagamento não tem rota de criação: nasce do evento `estoque.reservado`. Status: `PENDENTE` (gravado antes de chamar o banco), `APROVADO`, `RECUSADO`, `ERRO` (banco não respondeu: timeout, 5xx ou circuito aberto), `CANCELADO` (pedido cancelado antes da cobrança) e `ESTORNADO` (cobrado e devolvido). `tentativas` e `motivo` explicam o resultado sem abrir o log.

### banco-falso (fora do Kong, `http://localhost:9000`)
| Método | Rota | Resposta |
| :--- | :--- | :--- |
| `POST` | `/cobrancas` `{ valor, cartaoFinal, referencia }` | 201 `{ aprovado, codigo: "TX-..." }` · 402 `{ motivo: "saldo insuficiente" }` (cartão final `0002`) · 503 com `falhaPercent`% de chance. Mesma `referencia` = mesma resposta, sem cobrar de novo |
| `POST` | `/estornos` `{ codigo, referencia }` | 201 · 404 sem cobrança aprovada. Sem latência nem falha simulada |
| `GET` · `POST` | `/config` `{ latenciaMs, falhaPercent }` | 200 config atual / nova |

Corpo do checkout (`POST /pedidos`):
```json
{
  "endereco_entrega": { "cep": "01310-100", "logradouro": "Av. Paulista", "numero": "1578", "cidade": "São Paulo", "uf": "SP" },
  "forma_pagamento": "cartao",
  "numero_cartao": "4111111111111111"
}
```
`forma_pagamento`: `cartao`, `pix` ou `boleto`. Do cartão, só os 4 últimos dígitos são gravados (`cartao_final`).

---

## 📨 Eventos (Kafka)

Um broker Kafka 3.8 em modo KRaft, só na rede interna. Um tópico por entidade (`pedidos`, `estoque` e `pagamentos`), 3 partições cada, fator de replicação 1. Chave de todas as mensagens: o **id do pedido** (eventos do mesmo pedido, no mesmo tópico, chegam em ordem).

| Evento | Tópico | Publica | Consome | `dados` |
| :--- | :--- | :--- | :--- | :--- |
| `pedido.criado` | `pedidos` | `pedidos` (depois do commit) | `catalogo`, `notificacoes` | `usuarioId`, `clienteEmail`, `valorTotal`, `formaPagamento`, `cartaoFinal`, `itens` |
| `pedido.cancelado` | `pedidos` | `pedidos` (cancelamento do cliente) | `catalogo` (devolve o estoque), `pagamentos` (estorna ou bloqueia a cobrança) | `usuarioId`, `clienteEmail`, `valorTotal`, `motivo` |
| `estoque.reservado` | `estoque` | `catalogo` | `pedidos`, `pagamentos` (cobra) | `usuarioId`, `clienteEmail`, `itens`, `valorTotal`, `formaPagamento`, `cartaoFinal` |
| `estoque.insuficiente` | `estoque` | `catalogo` | `pedidos`, `notificacoes` | `motivo`, `usuarioId`, `clienteEmail` |
| `pagamento.aprovado` | `pagamentos` | `pagamentos` | `pedidos` (→ `PAGO`), `catalogo` (confirma a reserva), `notificacoes` | `usuarioId`, `clienteEmail`, `valor`, `codigoTransacao`, `tentativas` |
| `pagamento.recusado` | `pagamentos` | `pagamentos` (recusa do banco **ou** banco fora) | `pedidos` (→ `CANCELADO` com motivo), `catalogo` (devolve o estoque), `notificacoes` | `usuarioId`, `clienteEmail`, `valor`, `motivo`, `tentativas` |
| `pagamento.estornado` | `pagamentos` | `pagamentos` (cancelado depois de cobrado) | `notificacoes` | `usuarioId`, `clienteEmail`, `valor`, `codigoTransacao` |

### A saga (coreografia) e as compensações
| Passo (transação local) | Serviço | Compensação | Disparada por |
| :--- | :--- | :--- | :--- |
| Criar o pedido | `pedidos` | marcar `CANCELADO` com o motivo | `estoque.insuficiente`, `pagamento.recusado` |
| Reservar o estoque | `catalogo` | devolver ao disponível (`reservas.status` → `liberado`) | `pagamento.recusado`, `pedido.cancelado` |
| Cobrar | `pagamentos` | estornar no banco (`ESTORNADO`) ou bloquear a cobrança futura (`CANCELADO`) | `pedido.cancelado` |
| Avisar o cliente | `notificacoes` | outro e-mail | qualquer resultado de pagamento |

Cada serviço conhece só a própria compensação. Ordem pelo custo de desfazer: o estoque (barato de devolver) é reservado **antes** de cobrar (estorno custa taxa e aparece no extrato). Toda compensação é idempotente por filtro de estado: o catálogo só libera reserva `reservado`, o pedido só vai a `PAGO` a partir de `AGUARDANDO_PAGAMENTO`, o pagamento só estorna o que está `APROVADO`.

### Resiliência na chamada ao banco (`pagamentos/src/banco.ts`)
- **Timeout:** 2 s em toda chamada (`AbortSignal.timeout`). Timeout não é "não aconteceu": se todas as tentativas ficaram sem resposta, o pagamento pede o estorno da referência por segurança (404 = não havia cobrança).
- **Retry:** até 3 tentativas, esperando 500 ms e 1 s (+ jitter), só para timeout, erro de rede e 5xx. 402 e outros 4xx são respostas: não repetem. Seguro porque o banco reconhece a `referencia` (id do pedido) e não cobra duas vezes.
- **Circuit breaker:** `opossum`, abre com 50% de falha em pelo menos 5 chamadas, meio-aberto depois de 15 s. Com o circuito aberto, a cobrança falha na hora (sem chamar o banco). Estado em `GET /health/pagamentos`; logs `CIRCUITO ABERTO / MEIO-ABERTO / FECHADO`.
- **Fallback:** esgotou as tentativas ou circuito aberto → pagamento `ERRO` e `pagamento.recusado` com motivo "banco indisponível (...)". A saga compensa igual a uma recusa (decisão de negócio: cancelar em vez de deixar o pedido esperando).
- **Estorno:** não passa pelo circuit breaker (devolver dinheiro não pode ser barrado). Se falhar, o consumer relança e o Kafka reentrega até conseguir.

**Como demonstrar o circuit breaker** (`requests/demos.http`, seção 3): `POST localhost:9000/config { "falhaPercent": 100 }`, faça 2 ou 3 compras e veja `CIRCUITO ABERTO` em `docker compose logs -f pagamentos` e `"circuitoBancoExterno": "aberto"` em `GET /health/pagamentos`. Depois de 15 s ele fica `meio-aberto`; volte o banco com `{ "falhaPercent": 0 }`, faça uma compra e ele fecha sozinho.

Envelope igual em todos os eventos:
```json
{ "id": "uuid", "tipo": "pedido.criado", "pedidoId": "uuid", "ocorridoEm": "2026-10-29T18:30:00.123Z", "correlationId": "x-request-id do Kong", "dados": { } }
```
- **Group ids:** `pedidos`, `catalogo`, `pagamentos`, `notificacoes` (um por serviço; réplicas entram no mesmo grupo). Todos leem `fromBeginning`.
- **Entrega pelo menos uma vez:** todo consumer é idempotente. O catálogo usa `reservas.pedidoId` único e filtro de status da reserva; `pedidos` só muda o status a partir do estado esperado (`updateMany` condicional); `pagamentos` usa `pedido_id` UNIQUE (o mesmo evento não cria segunda linha nem cobra de novo).
- **Evento é contrato:** só se acrescentam campos; consumers validam só o que usam e ignoram tipos desconhecidos.
- **Sem dados sensíveis no evento:** nada de número de cartão, senha ou documento (só `cartaoFinal`).
- **`correlationId`:** o `X-Request-Id` do Kong segue de evento em evento e aparece nos logs (`[correlationId=...]`).

Ciclo de status do pedido:
```text
AGUARDANDO_ESTOQUE ──estoque.reservado──► AGUARDANDO_PAGAMENTO ──pagamento.aprovado──► PAGO
        │                                        │
        ├──estoque.insuficiente──────────────────┼──────────────► CANCELADO (com motivo_cancelamento)
        ├──pagamento.recusado────────────────────┤
        └──cliente cancela───────────────────────┘
```
Três caminhos para `CANCELADO`: `estoque.insuficiente` (de `AGUARDANDO_ESTOQUE`), `pagamento.recusado` (de `AGUARDANDO_ESTOQUE` ou `AGUARDANDO_PAGAMENTO`) e o cliente cancelando (`POST /pedidos/:id/cancelar`, nos mesmos dois status). `PAGO` é o fim feliz: cancelar depois de pago devolve 409. Um pedido `CANCELADO` não volta a `PAGO` porque o banco aprovou atrasado; nesse caso o `pagamentos` estorna.

---

## ⚠️ Limitações conhecidas

- **Escrita dupla (sem Outbox):** se o Kafka cair entre o commit do pedido e a publicação, o pedido fica em `AGUARDANDO_ESTOQUE` e o log registra o erro com o `correlationId`. O `POST /pedidos` responde 202 mesmo assim.
- **Mensagem venenosa (sem DLQ):** evento inválido é logado e descartado; não há tópico de erros.
- **Reserva parcial:** se o catálogo cair entre o insert em `reservas` e o fim do processamento, a reentrega é ignorada (`reservas.pedidoId` já existe) e o pedido pode ficar parado. O mesmo vale para confirmar/liberar: o status da reserva muda antes dos `$inc` nos produtos.
- **Cancelamento sem Outbox:** se o Kafka cair depois do `CANCELADO` gravado, o `pedido.cancelado` não sai (log com o `correlationId`): estoque e pagamento não são avisados.
- **Pagamento aprovado antes do `estoque.reservado` chegar ao pedidos:** os eventos vêm de tópicos diferentes. Pela regra da aula, `PAGO` só sai de `AGUARDANDO_PAGAMENTO`; se o `pagamento.aprovado` for processado primeiro, ele é ignorado e o pedido fica em `AGUARDANDO_PAGAMENTO` (raro: o pagamento só nasce depois do `estoque.reservado`).
- **Estorno que falha não vira estado gravado:** sem `ESTORNO_PENDENTE` nem DLQ. O estorno de um cancelamento é retentado pelo Kafka (bloqueia a partição até conseguir); o estorno "por segurança" depois de um timeout só fica no log (para a conciliação com o banco).
- **Circuito por réplica:** cada réplica de `pagamentos` tem o seu circuit breaker em memória (estado não compartilhado).
- **Cancelar com o pagamento demorando:** o consumer de `pagamentos` processa um evento por vez; com o banco lento, o `pedido.cancelado` espera a cobrança em andamento terminar (e então estorna).
- **banco-falso em memória:** reiniciar o container apaga as cobranças (e a idempotência por referência).
- **`fromBeginning` reenvia e-mails** quando um grupo novo nasce (ou o volume do Kafka é recriado). Na primeira subida do `pagamentos`, os `estoque.reservado` antigos do tópico são cobrados.
- **E-mail duplicado** é possível numa reentrega (pelo menos uma vez); o `pagamentos` republica o resultado gravado quando recebe o `estoque.reservado` repetido.
- **Kafka UI (8090), Mailpit (8025) e banco-falso (9000)** não têm autenticação: uso local/didático.

---

## 🛡️ Formato de Erro Padronizado

Todos os serviços respondem no mesmo formato:

```json
{ "erro": "Este e-mail já está cadastrado." }
```
```json
{ "erro": "Dados inválidos.", "detalhes": ["preco deve ser maior que zero", "sku é obrigatório"] }
```

- Nunca há vazamento de stack trace ou mensagens técnicas de banco de dados para o cliente.
- `senha_hash` nunca é retornada nas respostas HTTP.
- 401, 403, 404 de rota desconhecida e 429 recusados no gateway vêm no formato do Kong (`{ "message": ... }`).

---

## 🌱 Seeds Obrigatórios e Idempotência

1. **Usuários (`usuarios/prisma/seed.ts`):** `admin@loja.com` / `admin123` e `cliente@loja.com` / `cliente123` (com endereço).
2. **Catálogo (`catalogo/seeds/seed.ts`):** 3 categorias (`celulares`, `roupas`, `livros`) e 11 produtos com atributos diferentes por categoria, incluindo `CEL-005` "Celular Básico" com apenas 2 unidades (para testar o estoque insuficiente). O `estoque` só é gravado quando o produto é criado (`$setOnInsert`): reiniciar o `catalogo` não desfaz reservas nem compensações feitas pelos eventos.

Rodam automaticamente na subida dos containers; rodar de novo não duplica.

---

## 🧪 Testes com REST Client

Arquivos em `requests/`, todos com `@baseUrl = http://localhost:8080`:
- `usuarios.http`: login, cadastro, `/me`, endereços, admin, rate-limit, tentativa de se passar por admin com `X-User-Role`.
- `catalogo.http`: vitrine pública, rotas de admin com token de admin (201/200), de cliente (403) e sem token (401).
- `pedidos.http`: login → carrinho → checkout (202) → consultar pedido; erros de carrinho vazio, pedido de outro usuário (404), cancelamento (409) e catálogo fora (503). Seção 6: caminho feliz por eventos (`AGUARDANDO_PAGAMENTO`, estoque reservado, e-mail no Mailpit). Seção 7: sem estoque (`CANCELADO` com motivo, estoque intacto).
- `pagamentos.http` (aula 09): pagamento do dono (200), de outro cliente (404), admin (200), lista de admin (200), cliente na lista (403), sem token e com `X-User-*` forjado (401), `/cobrancas` pelo gateway (404).
- `fluxo-compra.http` (aula 09): a saga de ponta a ponta. A: compra aprovada (`PAGO`). B: cartão final `0002` (`CANCELADO` com motivo, estoque volta). C: cancelada no meio da cobrança (`ESTORNADO` ou `CANCELADO`, estoque volta). D: cancelar pedido `PAGO` (409).
- `demos.http` (aula 09): o banco-falso direto na porta 9000 (402, idempotência, estorno, 400, 503) e as demos de resiliência: `falhaPercent` 30 (retry resolve), 100 (circuito abre e fecha) e `latenciaMs` 3000 (timeout, `ERRO` e estorno por segurança).

Para rodar tudo do zero: `docker compose down -v && docker compose up -d --build`.

---

## 🏛️ Registros de Decisões de Arquitetura (ADRs)

### ADR 001: Padrão em Camadas baseado no BackendTv
- **Decisão:** Controllers instanciam Express Routers (`export default router;`), `routes.ts` conecta os prefixos via `routes.use(...)`. Serviços encapsulam regras de negócio e Repositories isolam o acesso a dados.

### ADR 002: PostgreSQL para Usuários e MongoDB para Catálogo
- **Decisão:** Usuários usam PostgreSQL devido à alta necessidade de integridade relacional (FKs, CASCADE, unicidade estrita). O Catálogo usa MongoDB pela alta heterogeneidade dos produtos e flexibilidade de atributos dinâmicos por categoria.

### ADR 003: Soft Delete para Produtos
- **Decisão:** Remoções de produtos através de `DELETE /produtos/:id` alteram a flag `ativo = false` sem deletar o documento físico, garantindo histórico de pedidos e integridade no e-commerce.

### ADR 004: Validação em Duas Etapas
- **Decisão:** Schemas Zod na camada de entrada com mensagens amigáveis e índices únicos no banco (`email`, `sku`, `slug`) como garantia final.

### ADR 005: Kong sem banco como API Gateway
- **Decisão:** Kong 3.9 em modo declarativo (`kong/kong.yml` versionado). Rotas com três níveis de acesso (`publico`, `logado` = jwt, `admin` = jwt + acl). Os consumers são perfis (`cliente`, `admin`), não pessoas: o plugin jwt acha o consumer pelo campo `perfil` do token.
- **Consequência:** só o gateway publica portas; os serviços confiam em `X-User-*` porque nada de fora alcança a rede interna. O Kong apaga esses cabeçalhos quando vêm do cliente.

### ADR 006: Pedidos com Postgres próprio e chamada síncrona ao catálogo
- **Decisão:** `pedidos` tem seu próprio Postgres, sem FK para usuários e produtos (outros bancos). No checkout, pergunta ao catálogo direto pela rede interna (`GET /produtos?ids=...`, uma chamada para todos os itens) com timeout de 3 s.
- **Consequência:** acoplamento temporal. Catálogo fora → checkout responde 503, mas carrinho e lista de pedidos continuam funcionando. Preço e nome são copiados para `itens_pedido` (histórico). O pedido nasce em `AGUARDANDO_ESTOQUE`; quem o faz andar são os eventos (ADR 007).

### ADR 007: Kafka e coreografia por eventos
- **Decisão:** um broker Kafka 3.8 em KRaft (fator 1), tópicos por entidade (`pedidos`, `estoque`, 3 partições), envelope único `{ id, tipo, pedidoId, ocorridoEm, correlationId, dados }`, chave da mensagem = id do pedido e `correlationId` = `X-Request-Id` do Kong. Coreografia: ninguém orquestra, cada serviço reage aos eventos e publica os seus. A publicação acontece depois do commit. Idempotência por chave única (`reservas.pedidoId`) e por filtro de estado (`updateMany` a partir de `AGUARDANDO_ESTOQUE`). `notificacoes` só escuta (sem banco, sem rota no Kong) e envia e-mail via Mailpit.
- **Consequência:** consistência eventual: o cliente consulta o status do pedido até ele sair de `AGUARDANDO_ESTOQUE`. Kafka UI (8090) e Mailpit (8025) publicam porta sem autenticação, só para uso local: exceção à regra "só o gateway publica portas". O checkout não recusa mais por estoque (409 só para produto inexistente ou inativo): quem decide é o catálogo, por `estoque.insuficiente`. Outbox e DLQ ficam como limitações conhecidas.

### ADR 008: Saga por coreografia com compensações
- **Contexto:** a compra atravessa três bancos (Postgres de pedidos, Mongo do catálogo, Postgres de pagamentos) e um banco de cartão externo. Não há `ROLLBACK` que desfaça os três, e 2PC não serve (Kafka, Mongo e o banco externo não participam; todos precisariam estar no ar).
- **Decisão:** saga por **coreografia** (a mesma do ADR 007): cada passo é uma transação local e tem uma compensação, disparada por evento. Novo serviço `pagamentos` com Postgres próprio, tópico `pagamentos` e os eventos `pedido.cancelado`, `pagamento.aprovado`, `pagamento.recusado` e `pagamento.estornado`. Ordem pelo custo de desfazer: reservar o estoque antes de cobrar. Idempotência por chave única (`pagamentos.pedido_id`) e por filtro de estado (reserva `reservado`, pedido `AGUARDANDO_*`, pagamento `APROVADO`). `estoque.reservado` passa a levar `cartaoFinal`: o pagamento não consulta outro serviço. Recusa do banco e banco fora dão no mesmo `pagamento.recusado` (motivos diferentes). Cancelar depois de `PAGO` não é permitido (409).
- **Consequência:** sem isolamento (ACID sem o I): outros veem estados intermediários (`AGUARDANDO_*`, estoque reservado de um pedido que vai ser recusado). O status funciona como cadeado. O fluxo fica espalhado pelos serviços (difícil de ver de uma vez): o `correlationId` nos logs junta a saga de um pedido. Corridas entre tópicos tratadas: cancelamento durante a cobrança (o `pedido_id` ocupado com `CANCELADO` bloqueia a cobrança futura; cobrança já aprovada é estornada) e `pagamento.aprovado` chegando ao catálogo antes do `pedido.cancelado` (a reserva confirmada também é devolvida).

### ADR 009: Resiliência na chamada ao banco externo e banco-falso fora do Kong
- **Contexto:** o banco do cartão não é nosso: demora, cai e recusa. Lento é pior que fora do ar (requisições presas derrubam os vizinhos).
- **Decisão:** em `pagamentos → banco` (e só ali, a camada mais próxima de quem falha): timeout de 2 s, retry de até 3 tentativas com backoff (500 ms, 1 s) e jitter só para timeout, erro de rede e 5xx, e circuit breaker com `opossum` (50% de falha em 5 chamadas, 15 s até o meio-aberto). Chave de idempotência = id do pedido (`referencia`), para o retry não cobrar duas vezes. Timeout sem resposta → estorno por segurança. Estorno fora do circuit breaker. Fallback: falhar rápido (pagamento `ERRO` → pedido cancelado). Estado do circuito no `/health`. O `banco-falso` simula o sistema externo (sem banco de dados, latência e falhas por `POST /config`) e publica a porta **9000** fora do Kong: ninguém deveria chamar o banco pela loja, e a porta serve só para as demos (outra exceção à regra "só o gateway publica portas", como no ADR 007).
- **Consequência:** a cobrança pode levar até ~7,5 s no pior caso (3 timeouts + esperas), sem ninguém esperando (é por evento). Um circuito por réplica (estado em memória): aceitável para o projeto. Banco fora cancela o pedido em vez de esperar: decisão de negócio mais simples; deixar o pedido esperando o banco voltar fica como alternativa.
