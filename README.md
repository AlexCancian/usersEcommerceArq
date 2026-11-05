# E-Commerce - Arquitetura de Microsserviços

Repositório estruturado no modelo de **monorepo com microsserviços independentes**. Cada serviço possui sua própria stack, dependências (`package.json`), banco de dados isolado e `Dockerfile`.

- **Aula 06:** `usuarios` (Postgres) e `catalogo` (MongoDB) no Docker Compose.
- **Aula 07:** API Gateway (Kong) na frente de tudo, JWT validado no gateway e o serviço `pedidos` (carrinho e checkout) consultando o catálogo.
- **Aula 08:** Kafka (KRaft) e eventos: o checkout publica, o catálogo reserva o estoque e as notificações avisam por e-mail (coreografia).

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
     ┌─────────┼──────────────┐
     ▼         ▼              ▼
 usuarios   catalogo  ◄──── pedidos      (pedidos → catalogo: chamada direta, sem gateway, timeout 3 s)
 Postgres   MongoDB         Postgres

Eventos (Kafka, só na rede interna; tópicos pedidos e estoque, 3 partições, chave = id do pedido):

 pedidos ──pedido.criado──► [pedidos] ──► catalogo ──estoque.reservado / estoque.insuficiente──► [estoque] ──► pedidos
                                    └──────────────► notificacoes ◄───────────────────────────────┘
                                                          │ SMTP
                                                          ▼
                                                       mailpit (caixa de entrada em :8025)
```

- **Gateway decide a porta:** quem é você (401) e se pode entrar na rota de admin (403).
- **Serviço decide o recurso:** este pedido/endereço é seu? (404) Ainda pode ser cancelado? (409)
- **`usuarios` é o único que emite JWT** (HS256, `{ sub, email, perfil, iss }`, vence em 2 h). Os serviços não validam token: leem os cabeçalhos `X-User-*` que o Kong injeta.

---

## 📁 Estrutura do Repositório

```text
usersEcommerceArq/
├── docker-compose.yml          # gateway + 4 serviços + 3 bancos + kafka, kafka-ui e mailpit
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
│       ├── consumers/          # estoque.consumer.ts: reage a estoque.reservado / estoque.insuficiente
│       ├── config/kafka.ts     # producer, consumer e criação dos tópicos
│       ├── utils/eventos.ts    # envelope e schemas Zod dos eventos
│       └── index.ts
├── notificacoes/               # só consumer Kafka + nodemailer (sem Express, sem banco, sem rota no Kong)
│   └── src/ config/ consumers/ services/ utils/
└── requests/
    ├── usuarios.http
    ├── catalogo.http
    └── pedidos.http
```

Cada serviço segue as camadas `controllers → services → repositories` (ADR 001) e escuta na **porta 3000 dentro do container**.

---

## 🚀 Como Executar

```bash
cp .env.example .env          # opcional: troca o JWT_SECRET
docker compose up --build
```

Sobem: `gateway` (Kong), `usuarios`, `catalogo`, `pedidos`, `notificacoes`, `postgres-usuarios`, `mongo-catalogo`, `postgres-pedidos`, `kafka`, `kafka-ui` e `mailpit`.
Os serviços esperam o Kafka ficar saudável (`depends_on` com `service_healthy`).
Cada container de serviço roda as próprias migrations e seeds idempotentes ao iniciar (os bancos não publicam porta).

| Porta | O que é |
| :--- | :--- |
| `8080` | **API da loja** (única URL usada pelos clientes) |
| `8001` | Admin API do Kong (leitura: `curl localhost:8001/routes`) |
| `8002` | Kong Manager (painel) |
| `8090` | Kafka UI (tópicos, mensagens, grupos e lag): só para uso local, sem autenticação |
| `8025` | Mailpit (caixa de entrada dos e-mails de mentira): só para uso local, sem autenticação |

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
| `POST` | `/pedidos/:id/cancelar` | logado | 200 cancelado · 409 status não permite |
| `GET` | `/health/pedidos` | público | 200 serviço e banco ok |

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

Um broker Kafka 3.8 em modo KRaft, só na rede interna. Dois tópicos por entidade (`pedidos` e `estoque`), 3 partições cada, fator de replicação 1. Chave de todas as mensagens: o **id do pedido** (eventos do mesmo pedido chegam em ordem).

| Evento | Tópico | Publica | Consome | `dados` |
| :--- | :--- | :--- | :--- | :--- |
| `pedido.criado` | `pedidos` | `pedidos` (depois do commit) | `catalogo`, `notificacoes` | `usuarioId`, `clienteEmail`, `valorTotal`, `formaPagamento`, `cartaoFinal`, `itens` |
| `estoque.reservado` | `estoque` | `catalogo` | `pedidos` (e pagamentos, na próxima aula) | `usuarioId`, `clienteEmail`, `itens`, `valorTotal`, `formaPagamento` |
| `estoque.insuficiente` | `estoque` | `catalogo` | `pedidos`, `notificacoes` | `motivo`, `usuarioId`, `clienteEmail` |

Envelope igual em todos os eventos:
```json
{ "id": "uuid", "tipo": "pedido.criado", "pedidoId": "uuid", "ocorridoEm": "2026-10-29T18:30:00.123Z", "correlationId": "x-request-id do Kong", "dados": { } }
```
- **Group ids:** `pedidos`, `catalogo`, `notificacoes` (um por serviço; réplicas entram no mesmo grupo). Todos leem `fromBeginning`.
- **Entrega pelo menos uma vez:** todo consumer é idempotente. O catálogo usa `reservas.pedidoId` único; `pedidos` só muda o status a partir de `AGUARDANDO_ESTOQUE` (`updateMany` condicional).
- **Evento é contrato:** só se acrescentam campos; consumers validam só o que usam e ignoram tipos desconhecidos.
- **Sem dados sensíveis no evento:** nada de número de cartão, senha ou documento (só `cartaoFinal`).
- **`correlationId`:** o `X-Request-Id` do Kong segue de evento em evento e aparece nos logs (`[correlationId=...]`).

Ciclo de status do pedido:
```text
AGUARDANDO_ESTOQUE ──estoque.reservado──► AGUARDANDO_PAGAMENTO ──(próxima aula)──► PAGO
        │
        └──estoque.insuficiente──► CANCELADO (com motivo_cancelamento)
```
O cancelamento manual (`POST /pedidos/:id/cancelar`) continua permitido em `AGUARDANDO_ESTOQUE` e `AGUARDANDO_PAGAMENTO`.

---

## ⚠️ Limitações conhecidas

- **Escrita dupla (sem Outbox):** se o Kafka cair entre o commit do pedido e a publicação, o pedido fica em `AGUARDANDO_ESTOQUE` e o log registra o erro com o `correlationId`. O `POST /pedidos` responde 202 mesmo assim.
- **Mensagem venenosa (sem DLQ):** evento inválido é logado e descartado; não há tópico de erros.
- **Reserva parcial:** se o catálogo cair entre o insert em `reservas` e o fim do processamento, a reentrega é ignorada (`reservas.pedidoId` já existe) e o pedido pode ficar parado.
- **Cancelamento não devolve estoque:** a devolução vem com a saga, na próxima aula.
- **`fromBeginning` reenvia e-mails** quando um grupo novo nasce (ou o volume do Kafka é recriado).
- **E-mail duplicado** é possível numa reentrega (pelo menos uma vez).
- **Seed do catálogo repõe `estoque`** a cada subida do container `catalogo`: `reservado` volta a zero e fica incoerente com `reservas`.
- **Kafka UI (8090) e Mailpit (8025)** não têm autenticação e expõem dados (e-mails de clientes): uso local/didático.

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
2. **Catálogo (`catalogo/seeds/seed.ts`):** 3 categorias (`celulares`, `roupas`, `livros`) e 11 produtos com atributos diferentes por categoria, incluindo `CEL-005` "Celular Básico" com apenas 2 unidades (para testar o estoque insuficiente).

Rodam automaticamente na subida dos containers; rodar de novo não duplica.

---

## 🧪 Testes com REST Client

Arquivos em `requests/`, todos com `@baseUrl = http://localhost:8080`:
- `usuarios.http`: login, cadastro, `/me`, endereços, admin, rate-limit, tentativa de se passar por admin com `X-User-Role`.
- `catalogo.http`: vitrine pública, rotas de admin com token de admin (201/200), de cliente (403) e sem token (401).
- `pedidos.http`: login → carrinho → checkout (202) → consultar pedido; erros de carrinho vazio, pedido de outro usuário (404), cancelamento (409) e catálogo fora (503). Seção 6: caminho feliz por eventos (`AGUARDANDO_PAGAMENTO`, estoque reservado, e-mail no Mailpit). Seção 7: sem estoque (`CANCELADO` com motivo, estoque intacto).

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
