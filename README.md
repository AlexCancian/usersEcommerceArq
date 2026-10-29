# E-Commerce - Arquitetura de Microsserviços

Repositório estruturado no modelo de **monorepo com microsserviços independentes**. Cada serviço possui sua própria stack, dependências (`package.json`), banco de dados isolado e `Dockerfile`.

- **Aula 06:** `usuarios` (Postgres) e `catalogo` (MongoDB) no Docker Compose.
- **Aula 07:** API Gateway (Kong) na frente de tudo, JWT validado no gateway e o serviço `pedidos` (carrinho e checkout) consultando o catálogo.

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
```

- **Gateway decide a porta:** quem é você (401) e se pode entrar na rota de admin (403).
- **Serviço decide o recurso:** este pedido/endereço é seu? (404) Ainda pode ser cancelado? (409)
- **`usuarios` é o único que emite JWT** (HS256, `{ sub, email, perfil, iss }`, vence em 2 h). Os serviços não validam token: leem os cabeçalhos `X-User-*` que o Kong injeta.

---

## 📁 Estrutura do Repositório

```text
usersEcommerceArq/
├── docker-compose.yml          # gateway + 3 serviços + 3 bancos (só o gateway publica portas)
├── .env.example                # JWT_SECRET compartilhado por usuarios e gateway
├── kong/
│   └── kong.yml                # Kong sem banco: services, routes, consumers e plugins
├── usuarios/                   # Express + Prisma + PostgreSQL (emite o JWT)
├── catalogo/                   # Express + Mongoose + MongoDB
├── pedidos/                    # Express + Prisma + PostgreSQL (carrinho e checkout)
│   ├── prisma/schema.prisma    # carrinho_itens, pedidos, itens_pedido
│   └── src/
│       ├── catalogo.ts         # chamada síncrona ao catálogo (timeout 3 s → 503)
│       ├── middleware/auth.ts  # lê X-User-* injetados pelo gateway
│       ├── repositories/ services/ controllers/ routes/
│       └── index.ts
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

Sobem: `gateway` (Kong), `usuarios`, `catalogo`, `pedidos`, `postgres-usuarios`, `mongo-catalogo` e `postgres-pedidos`.
Cada container de serviço roda as próprias migrations e seeds idempotentes ao iniciar (os bancos não publicam porta).

| Porta | O que é |
| :--- | :--- |
| `8080` | **API da loja** (única URL usada pelos clientes) |
| `8001` | Admin API do Kong (leitura: `curl localhost:8001/routes`) |
| `8002` | Kong Manager (painel) |

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
| `POST` | `/pedidos` | logado | 202 aceito · 400 carrinho vazio · 409 produto indisponível · 503 catálogo fora |
| `GET` | `/pedidos` | logado | 200 meus pedidos |
| `GET` | `/pedidos/:id` | logado | 200 pedido com itens · 404 não existe ou não é meu |
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
2. **Catálogo (`catalogo/seeds/seed.ts`):** 3 categorias (`celulares`, `roupas`, `livros`) e 10 produtos com atributos diferentes por categoria.

Rodam automaticamente na subida dos containers; rodar de novo não duplica.

---

## 🧪 Testes com REST Client

Arquivos em `requests/`, todos com `@baseUrl = http://localhost:8080`:
- `usuarios.http`: login, cadastro, `/me`, endereços, admin, rate-limit, tentativa de se passar por admin com `X-User-Role`.
- `catalogo.http`: vitrine pública, rotas de admin com token de admin (201/200), de cliente (403) e sem token (401).
- `pedidos.http`: login → carrinho → checkout (202) → consultar pedido; erros de carrinho vazio, pedido de outro usuário (404), cancelamento (409) e catálogo fora (503).

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
- **Consequência:** acoplamento temporal. Catálogo fora → checkout responde 503, mas carrinho e lista de pedidos continuam funcionando. Preço e nome são copiados para `itens_pedido` (histórico). O pedido nasce em `AGUARDANDO_ESTOQUE`; quem o faz andar é o Kafka, na próxima aula.
