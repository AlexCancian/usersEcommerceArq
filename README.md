# E-Commerce - Arquitetura de Microsserviços

Repositório estruturado no modelo de **monorepo com microsserviços independentes**. Cada serviço possui sua própria stack, dependências (`package.json`), banco de dados isolado e `Dockerfile`.

---

## 📁 Estrutura do Repositório

```text
usersEcommerceArq/
├── docker-compose.yml                      # Orquestrador: Postgres, Mongo, usuarios e catalogo
├── README.md                               # Documentação e ADRs
├── .gitignore
├── usuarios/                               # Microsserviço de Usuários e Autenticação (PostgreSQL)
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example & .env
│   ├── prisma/
│   │   ├── schema.prisma                   # Modelagem relacional PostgreSQL
│   │   └── seed.ts                         # Seed idempotente (admin e cliente)
│   └── src/
│       ├── config/                         # Conexão db.ts e variáveis env.ts
│       ├── utils/                          # errors.ts, jwt.ts, password.ts, schemas.ts
│       ├── middleware/                     # auth.ts (com requireRoles), validate.ts, errorHandler.ts
│       ├── repositories/                   # usuario.repository.ts, endereco.repository.ts
│       ├── services/                       # auth.service.ts, usuario.service.ts, endereco.service.ts
│       ├── controllers/                    # Routers: auth.controller.ts, usuario.controller.ts, health.controller.ts
│       ├── routes/                         # Centralizador que conecta os routers (routes.use)
│       └── index.ts                        # Servidor Express na porta 3001
├── catalogo/                               # Microsserviço de Catálogo (MongoDB)
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example & .env
│   ├── seeds/
│   │   └── seed.ts                         # Seed idempotente (3 categorias, 10 produtos heterogêneos)
│   └── src/
│       ├── config/                         # Conexão db.ts (Mongoose) e variáveis env.ts
│       ├── utils/                          # errors.ts, schemas.ts
│       ├── models/                         # categoria.model.ts, produto.model.ts
│       ├── middleware/                     # validate.ts, errorHandler.ts
│       ├── repositories/                   # categoria.repository.ts, produto.repository.ts
│       ├── services/                       # categoria.service.ts, produto.service.ts
│       ├── controllers/                    # Routers: categoria.controller.ts, produto.controller.ts, health.controller.ts
│       ├── routes/                         # Centralizador que conecta os routers (routes.use)
│       └── index.ts                        # Servidor Express na porta 3002
└── requests/
    ├── usuarios.http                       # Requisições para teste do serviço de Usuários (REST Client)
    └── catalogo.http                       # Requisições para teste do serviço de Catálogo (REST Client)
```

---

## 🚀 Como Executar o Projeto

### Opção 1: Com Docker Compose (Orquestração Completa)

Na raiz do repositório, execute:

```bash
docker compose up --build
```

Isso subirá todos os serviços e bancos automaticamente:
- **`postgres-usuarios`**: PostgreSQL na porta `5432`.
- **`usuarios`**: API de Usuários na porta `3001` (`http://localhost:3001`).
- **`mongo-catalogo`**: MongoDB na porta `27017`.
- **`catalogo`**: API de Catálogo na porta `3002` (`http://localhost:3002`).

---

### Opção 2: Execução Local em Desenvolvimento

#### 1. Microsserviço de Usuários (Porta 3001)

1. Suba o PostgreSQL (`docker compose up postgres-usuarios -d`).
2. Acesse a pasta `usuarios`:
   ```bash
   cd usuarios
   npm install
   cp .env.example .env
   npx prisma generate
   npx prisma migrate dev --name init
   npm run seed
   npm run dev
   ```

#### 2. Microsserviço de Catálogo (Porta 3002)

1. Suba o MongoDB (`docker compose up mongo-catalogo -d`).
2. Acesse a pasta `catalogo`:
   ```bash
   cd catalogo
   npm install
   cp .env.example .env
   npm run seed
   npm run dev
   ```

---

## 📌 Rotas da API de Usuários (Porta 3001)

| Método | Endpoint | Acesso | Descrição | Status Codes |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/health` | Público | Healthcheck da aplicação e conexão com banco | `200` / `500` |
| `POST` | `/auth/login` | Público | Autenticação com e-mail e senha. Devolve JWT | `200` / `401` |
| `POST` | `/usuarios` | Público | Cadastro de novos clientes | `201` / `400` / `409` |
| `GET` | `/usuarios/me` | Logado | Retorna dados cadastrais do usuário autenticado | `200` / `401` |
| `PUT` | `/usuarios/me` | Logado | Atualiza dados cadastrais do usuário | `200` / `400` / `409` |
| `GET` | `/usuarios/me/enderecos` | Logado | Lista os endereços cadastrados do usuário | `200` / `401` |
| `POST` | `/usuarios/me/enderecos` | Logado | Cadastra um novo endereço para o usuário | `201` / `400` |
| `DELETE` | `/usuarios/me/enderecos/:id` | Logado | Remove endereço informado | `204` / `404` |
| `GET` | `/usuarios` | Admin | Listagem completa de usuários (sem `senha_hash`) | `200` / `403` |

---

## 📌 Rotas da API de Catálogo (Porta 3002)

| Método | Endpoint | Acesso | Descrição | Status Codes |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/health` | Público | Healthcheck da aplicação e conexão com MongoDB | `200` / `500` |
| `GET` | `/categorias` | Público | Lista todas as categorias | `200` |
| `POST` | `/categorias` | Admin (aberto) | Cadastra nova categoria (`nome`, `slug` único) | `201` / `400` / `409` |
| `GET` | `/produtos?categoria=&busca=` | Público | Lista produtos ativos (`ativo: true`) com filtros | `200` |
| `GET` | `/produtos/:id` | Público | Busca produto por ID ou SKU | `200` / `404` |
| `POST` | `/produtos` | Admin (aberto) | Cria novo produto com atributos flexíveis e estoque | `201` / `400` / `409` |
| `PUT` | `/produtos/:id` | Admin (aberto) | Atualiza dados completos do produto | `200` / `400` / `404` |
| `PATCH` | `/produtos/:id/estoque` | Admin (aberto) | Ajusta estoque (`disponivel`, `reservado`) | `200` / `400` / `404` |
| `DELETE` | `/produtos/:id` | Admin (aberto) | Soft Delete: define `ativo = false` (não apaga) | `204` / `404` |

> *Nota (Slide 8): As rotas de admin do catálogo ficam abertas por enquanto. A validação de token entre serviços será gerenciada pelo API Gateway na próxima etapa.*

---

## 🛡️ Formato de Erro Padronizado (Slide 9)

Ambos os serviços respondem com o mesmo formato padronizado:

**Erro simples:**
```json
{
  "erro": "Este e-mail já está cadastrado."
}
```

**Erro de validação (400 Bad Request):**
```json
{
  "erro": "Dados inválidos.",
  "detalhes": [
    "preco deve ser maior que zero",
    "sku é obrigatório"
  ]
}
```

- Nunca há vazamento de stack trace ou mensagens técnicas de banco de dados para o cliente.
- `senha_hash` nunca é retornada nas respostas HTTP.

---

## 🌱 Seeds Obrigatórios e Idempotência

Ambos os serviços possuem seeds idempotentes (`npm run seed`):

1. **Usuários (`usuarios/prisma/seed.ts`):**
   - Admin: `admin@loja.com` / `admin123`
   - Cliente: `cliente@loja.com` / `cliente123` (com endereço padrão associado).
2. **Catálogo (`catalogo/seeds/seed.ts`):**
   - 3 Categorias: `celulares`, `roupas`, `livros`.
   - 10 Produtos com atributos dinâmicos e heterogêneos por categoria (ex: celular com `memoria`/`cor`/`5G`, roupas com `tamanho`/`tecido`, livros com `autor`/`paginas`/`editora`).

---

## 🧪 Testes com REST Client (Extensão do VS Code / Antigravity)

Os arquivos de teste estão organizados na pasta `requests/`:
- 👉 [usuarios.http](file:///c:/Users/AlexCancian/Desktop/arq/usersEcommerceArq/requests/usuarios.http): Todas as rotas de usuários, login, perfil `/me`, CRUD de endereços e permissão de admin.
- 👉 [catalogo.http](file:///c:/Users/AlexCancian/Desktop/arq/usersEcommerceArq/requests/catalogo.http): Todas as rotas de categorias, produtos ativos, busca, criação, ajuste de estoque e soft delete.

### Como usar:
1. Instale a extensão **REST Client** (Huachao Mao) no seu editor, se ainda não tiver.
2. Abra `requests/usuarios.http` ou `requests/catalogo.http`.
3. Clique em **"Send Request"** logo acima de qualquer requisição.
4. As requisições de login e criação utilizam a diretiva `# @name` para extrair automaticamente tokens JWT e IDs para as chamadas subsequentes sem necessidade de copiar e colar manualmente.

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
