# Contrato: kafka-eventos
Data: 29/10/2026
Modo: perfil `aulas-ecommerce` — projeto único, um serviço por pasta, **sem `src/shared/schemas/`**.
Schemas: Zod escritos abaixo **por serviço**, cada um no próprio `src/utils/eventos.ts`. Nenhum serviço importa código de outro (a duplicação é intencional, slide "O ENVELOPE": "um kafka.js igual em cada um").
Formato de erro HTTP: inalterado — `{ "erro": "...", "detalhes"?: [...] }`.

> Fonte da verdade entre os serviços. Só o arquiteto altera. Evento é contrato: só acrescentar campos (RN13).

---

## 1. Rotas HTTP

**Nenhuma rota nova. `kong/kong.yml` não muda.** `notificacoes` não tem HTTP (sem Express, sem porta, sem health no Kong).

### Mudanças aditivas nas respostas de `pedidos`
| Rota (pelo Kong) | Acesso | Mudança |
|---|---|---|
| `POST /pedidos` | logado | Continua **202** com o pedido em `AGUARDANDO_ESTOQUE`. Ganha `motivo_cancelamento: null`. **D19:** deixa de devolver 409 por estoque insuficiente; o 409 fica só para produto inexistente/inativo. Depois do commit publica `pedido.criado`; falha do Kafka **não** muda a resposta (D04) |
| `GET /pedidos` | logado | Cada pedido ganha `motivo_cancelamento: string \| null` |
| `GET /pedidos/:id` | logado | Ganha `motivo_cancelamento: string \| null`. O status muda sozinho (consistência eventual): `AGUARDANDO_ESTOQUE` → `AGUARDANDO_PAGAMENTO` ou `CANCELADO` |
| `POST /pedidos/:id/cancelar` | logado | Sem mudança de regra (RN08). Resposta ganha `motivo_cancelamento` (fica `null` no cancelamento manual, D13) |

Status possíveis (inalterados): `POST /pedidos` 202 · 400 · 401 · 409 · 503; `GET /pedidos` 200 · 401; `GET /pedidos/:id` 200 · 401 · 404; cancelar 200 · 401 · 404 · 409.

Exemplo `GET /pedidos/:id` (cancelado por estoque):
```json
{
  "id": "8a2f6c1e-3b4d-4e5f-9a10-1b2c3d4e5f60",
  "cliente_email": "cliente@loja.com",
  "status": "CANCELADO",
  "valor_total": "2999.70",
  "endereco_entrega": { "cep": "01310-100", "logradouro": "Avenida Paulista", "cidade": "São Paulo", "uf": "SP" },
  "forma_pagamento": "pix",
  "cartao_final": null,
  "motivo_cancelamento": "Estoque insuficiente para Celular Básico (pedido: 3, disponível: 2).",
  "criado_em": "2026-10-29T18:30:00.000Z",
  "itens": [
    { "produto_id": "6720f0c1a1b2c3d4e5f60718", "nome_produto": "Celular Básico", "preco_unitario": "999.90", "quantidade": 3 }
  ]
}
```

---

## 2. Kafka — visão geral

| Item | Valor |
|---|---|
| Broker | `kafka:9092` (rede `ecommerce-net`, PLAINTEXT, sem porta publicada) |
| Tópicos | `pedidos`, `estoque` — 3 partições, replicationFactor 1, retenção padrão (7 dias). Criados por quem sobe primeiro: `admin.listTopics()` + `admin.createTopics()` (RF06) |
| Chave da mensagem | `pedidoId` (ordem por pedido) |
| Valor | `JSON.stringify(envelope)` (UTF-8) |
| Particionador | `Partitioners.DefaultPartitioner` (D25) |
| Entrega | pelo menos uma vez; commit automático do kafkajs ao terminar o `eachMessage` |
| `clientId` | nome do serviço (`pedidos`, `catalogo`, `notificacoes`) |

### Consumer groups
| groupId | Serviço | Tópicos | `fromBeginning` | Tipos tratados (o resto é ignorado) |
|---|---|---|---|---|
| `pedidos` | pedidos | `estoque` | `true` (D21) | `estoque.reservado`, `estoque.insuficiente` |
| `catalogo` | catalogo | `pedidos` | `true` | `pedido.criado` |
| `notificacoes` | notificacoes | `pedidos`, `estoque` | `true` (D21) | `pedido.criado`, `estoque.insuficiente` |

### Eventos
| Evento | Tópico | Publica (dono do fato) | Consome | `dados` |
|---|---|---|---|---|
| `pedido.criado` | `pedidos` | pedidos (depois do commit) | catalogo, notificacoes | `usuarioId`, `clienteEmail`, `valorTotal`, `formaPagamento`, `cartaoFinal`, `itens` |
| `estoque.reservado` | `estoque` | catalogo | pedidos (pagamentos na aula 09) | `usuarioId`, `clienteEmail`, `itens`, `valorTotal`, `formaPagamento` |
| `estoque.insuficiente` | `estoque` | catalogo | pedidos, notificacoes | `motivo`, `usuarioId`, `clienteEmail` |

### Envelope (todos os eventos)
| Campo | Tipo | Regra |
|---|---|---|
| `id` | string UUID | `crypto.randomUUID()` por evento |
| `tipo` | string | `entidade.fato` no passado |
| `pedidoId` | string | id do pedido (UUID gerado pelo Postgres de `pedidos`); igual à chave da mensagem |
| `ocorridoEm` | string ISO 8601 UTC | `new Date().toISOString()` no momento da publicação |
| `correlationId` | string | `X-Request-Id` do Kong; ausente → `randomUUID()` (D05); repassado de evento em evento |
| `dados` | objeto | conteúdo do tipo |

### Item de pedido no evento (camelCase, D02)
| Campo | Tipo | Origem |
|---|---|---|
| `produtoId` | string (ObjectId do Mongo em texto) | `itens_pedido.produto_id` |
| `nomeProduto` | string | `itens_pedido.nome_produto` |
| `precoUnitario` | number (2 casas) | `itens_pedido.preco_unitario.toNumber()` |
| `quantidade` | number inteiro > 0 | `itens_pedido.quantidade` |

### Proibido no evento (RN10)
Número do cartão, senha, `senha_hash`, CPF/documento, endereço de entrega. Do cartão, só `cartaoFinal` (4 dígitos ou `null`).

---

## 3. Exemplos JSON

### `pedido.criado` (tópico `pedidos`, key `8a2f6c1e-…`)
```json
{
  "id": "0b8c2a4e-6f1d-4d3a-9c2b-7e5f4a3b2c1d",
  "tipo": "pedido.criado",
  "pedidoId": "8a2f6c1e-3b4d-4e5f-9a10-1b2c3d4e5f60",
  "ocorridoEm": "2026-10-29T18:30:00.123Z",
  "correlationId": "34781360-5c2e-4f8a-b1d0-9e8f7a6b5c4d",
  "dados": {
    "usuarioId": "5d3e1f2a-7b8c-4d9e-a0f1-2b3c4d5e6f70",
    "clienteEmail": "cliente@loja.com",
    "valorTotal": 2619.7,
    "formaPagamento": "cartao",
    "cartaoFinal": "1111",
    "itens": [
      { "produtoId": "6720f0c1a1b2c3d4e5f60701", "nomeProduto": "Smartphone X", "precoUnitario": 2499.9, "quantidade": 1 },
      { "produtoId": "6720f0c1a1b2c3d4e5f60705", "nomeProduto": "Camiseta básica", "precoUnitario": 59.9, "quantidade": 2 }
    ]
  }
}
```

### `estoque.reservado` (tópico `estoque`, mesma key)
```json
{
  "id": "1c9d3b5f-7a2e-4e4b-8d3c-8f6a5b4c3d2e",
  "tipo": "estoque.reservado",
  "pedidoId": "8a2f6c1e-3b4d-4e5f-9a10-1b2c3d4e5f60",
  "ocorridoEm": "2026-10-29T18:30:00.456Z",
  "correlationId": "34781360-5c2e-4f8a-b1d0-9e8f7a6b5c4d",
  "dados": {
    "usuarioId": "5d3e1f2a-7b8c-4d9e-a0f1-2b3c4d5e6f70",
    "clienteEmail": "cliente@loja.com",
    "itens": [
      { "produtoId": "6720f0c1a1b2c3d4e5f60701", "nomeProduto": "Smartphone X", "precoUnitario": 2499.9, "quantidade": 1 },
      { "produtoId": "6720f0c1a1b2c3d4e5f60705", "nomeProduto": "Camiseta básica", "precoUnitario": 59.9, "quantidade": 2 }
    ],
    "valorTotal": 2619.7,
    "formaPagamento": "cartao"
  }
}
```

### `estoque.insuficiente` (tópico `estoque`)
```json
{
  "id": "2d0e4c6a-8b3f-4f5c-9e4d-9a7b6c5d4e3f",
  "tipo": "estoque.insuficiente",
  "pedidoId": "9b3a7d2f-4c5e-4f60-8b21-2c3d4e5f6071",
  "ocorridoEm": "2026-10-29T18:31:10.789Z",
  "correlationId": "4f2a1b3c-6d7e-4a8b-9c0d-1e2f3a4b5c6d",
  "dados": {
    "motivo": "Estoque insuficiente para Celular Básico (pedido: 3, disponível: 2).",
    "usuarioId": "5d3e1f2a-7b8c-4d9e-a0f1-2b3c4d5e6f70",
    "clienteEmail": "cliente@loja.com"
  }
}
```

Formatos de `motivo` (PT-BR, um por causa, D08):
- sem estoque: `Estoque insuficiente para <nome> (pedido: <qtd>, disponível: <disp>).`
- produto não existe ou `produtoId` inválido: `Produto <nomeProduto> (<produtoId>) não encontrado no catálogo.`

---

## 4. Schemas Zod por serviço

Regras comuns: objetos **sem** `.strict()` (campo novo é ignorado, RN13/D22); consumer valida o envelope, ignora `tipo` desconhecido, depois valida só os `dados` que usa. Falha de JSON/Zod = log de erro com `[correlationId=…]` (ou `-` se ilegível) e descarte (D06). Erro de banco/SMTP = log + `throw` (retry do kafkajs).

### 4.1 `pedidos/src/utils/eventos.ts` (produz `pedido.criado`; consome `estoque.*`)
```ts
import { z } from "zod";

export const TOPICOS = {
  PEDIDOS: "pedidos",
  ESTOQUE: "estoque",
} as const;
export type Topico = (typeof TOPICOS)[keyof typeof TOPICOS];

export const TIPOS = {
  PEDIDO_CRIADO: "pedido.criado",
  ESTOQUE_RESERVADO: "estoque.reservado",
  ESTOQUE_INSUFICIENTE: "estoque.insuficiente",
} as const;

// Envelope publicado (aula 08, slide "O ENVELOPE")
export interface Envelope<TDados> {
  id: string;
  tipo: string;
  pedidoId: string;
  ocorridoEm: string;
  correlationId: string;
  dados: TDados;
}

// Envelope recebido: dados ainda desconhecidos até olhar o tipo
export const envelopeRecebidoSchema = z.object({
  id: z.string().uuid("id do evento deve ser um UUID."),
  tipo: z.string().min(1, "tipo é obrigatório."),
  pedidoId: z.string().min(1, "pedidoId é obrigatório."),
  ocorridoEm: z.string().datetime({ message: "ocorridoEm deve ser ISO 8601 UTC." }),
  correlationId: z.string().min(1, "correlationId é obrigatório."),
  dados: z.unknown(),
});
export type EnvelopeRecebido = z.infer<typeof envelopeRecebidoSchema>;

// ---- Produzido: pedido.criado
export const itemEventoSchema = z.object({
  produtoId: z.string().min(1),
  nomeProduto: z.string().min(1),
  precoUnitario: z.number().nonnegative(),
  quantidade: z.number().int().positive(),
});
export type ItemEvento = z.infer<typeof itemEventoSchema>;

export const pedidoCriadoDadosSchema = z.object({
  usuarioId: z.string().uuid(),
  clienteEmail: z.string().email(),
  valorTotal: z.number().nonnegative(),
  formaPagamento: z.enum(["cartao", "pix", "boleto"]),
  cartaoFinal: z.string().regex(/^\d{4}$/).nullable(),
  itens: z.array(itemEventoSchema).min(1),
});
export type PedidoCriadoDados = z.infer<typeof pedidoCriadoDadosSchema>;

// ---- Consumido: estoque.* (pedidos só usa o pedidoId e o motivo — leitor tolerante)
// pedidoId vira filtro numa coluna UUID: validar antes do Prisma evita P2023 em loop.
export const pedidoIdEventoSchema = z.string().uuid("pedidoId deve ser um UUID.");

export const estoqueReservadoDadosSchema = z.object({});
export type EstoqueReservadoDados = z.infer<typeof estoqueReservadoDadosSchema>;

export const estoqueInsuficienteDadosSchema = z.object({
  motivo: z.string().min(1, "motivo é obrigatório.").max(500, "motivo deve ter no máximo 500 caracteres."),
});
export type EstoqueInsuficienteDados = z.infer<typeof estoqueInsuficienteDadosSchema>;
```

### 4.2 `catalogo/src/utils/eventos.ts` (consome `pedido.criado`; produz `estoque.*`)
```ts
import { z } from "zod";

export const TOPICOS = {
  PEDIDOS: "pedidos",
  ESTOQUE: "estoque",
} as const;
export type Topico = (typeof TOPICOS)[keyof typeof TOPICOS];

export const TIPOS = {
  PEDIDO_CRIADO: "pedido.criado",
  ESTOQUE_RESERVADO: "estoque.reservado",
  ESTOQUE_INSUFICIENTE: "estoque.insuficiente",
} as const;

export interface Envelope<TDados> {
  id: string;
  tipo: string;
  pedidoId: string;
  ocorridoEm: string;
  correlationId: string;
  dados: TDados;
}

export const envelopeRecebidoSchema = z.object({
  id: z.string().uuid("id do evento deve ser um UUID."),
  tipo: z.string().min(1, "tipo é obrigatório."),
  pedidoId: z.string().min(1, "pedidoId é obrigatório."),
  ocorridoEm: z.string().datetime({ message: "ocorridoEm deve ser ISO 8601 UTC." }),
  correlationId: z.string().min(1, "correlationId é obrigatório."),
  dados: z.unknown(),
});
export type EnvelopeRecebido = z.infer<typeof envelopeRecebidoSchema>;

// Itens: o catálogo usa produtoId/quantidade e repassa nomeProduto/precoUnitario no estoque.reservado
export const itemEventoSchema = z.object({
  produtoId: z.string().min(1, "produtoId é obrigatório."),
  nomeProduto: z.string().min(1, "nomeProduto é obrigatório."),
  precoUnitario: z.number().nonnegative("precoUnitario não pode ser negativo."),
  quantidade: z.number().int("quantidade deve ser inteira.").positive("quantidade deve ser maior que zero."),
});
export type ItemEvento = z.infer<typeof itemEventoSchema>;

// ---- Consumido: pedido.criado (cartaoFinal não é usado nem repassado)
export const pedidoCriadoDadosSchema = z.object({
  usuarioId: z.string().min(1, "usuarioId é obrigatório."),
  clienteEmail: z.string().email("clienteEmail inválido."),
  valorTotal: z.number().nonnegative("valorTotal não pode ser negativo."),
  formaPagamento: z.string().min(1, "formaPagamento é obrigatória."),
  itens: z.array(itemEventoSchema).min(1, "itens não pode ser vazio."),
});
export type PedidoCriadoDados = z.infer<typeof pedidoCriadoDadosSchema>;

// ---- Produzidos
export interface EstoqueReservadoDados {
  usuarioId: string;
  clienteEmail: string;
  itens: ItemEvento[];
  valorTotal: number;
  formaPagamento: string;
}

export interface EstoqueInsuficienteDados {
  motivo: string;
  usuarioId: string;
  clienteEmail: string;
}
```

### 4.3 `notificacoes/src/utils/eventos.ts` (consome `pedido.criado` e `estoque.insuficiente`; não produz)
```ts
import { z } from "zod";

export const TOPICOS = {
  PEDIDOS: "pedidos",
  ESTOQUE: "estoque",
} as const;
export type Topico = (typeof TOPICOS)[keyof typeof TOPICOS];

export const TIPOS = {
  PEDIDO_CRIADO: "pedido.criado",
  ESTOQUE_INSUFICIENTE: "estoque.insuficiente",
} as const;

export const envelopeRecebidoSchema = z.object({
  id: z.string().uuid("id do evento deve ser um UUID."),
  tipo: z.string().min(1, "tipo é obrigatório."),
  pedidoId: z.string().min(1, "pedidoId é obrigatório."),
  ocorridoEm: z.string().datetime({ message: "ocorridoEm deve ser ISO 8601 UTC." }),
  correlationId: z.string().min(1, "correlationId é obrigatório."),
  dados: z.unknown(),
});
export type EnvelopeRecebido = z.infer<typeof envelopeRecebidoSchema>;

// Só o que o e-mail usa (leitor tolerante)
export const itemEmailSchema = z.object({
  nomeProduto: z.string().min(1),
  quantidade: z.number().int().positive(),
});

export const pedidoCriadoDadosSchema = z.object({
  clienteEmail: z.string().email("clienteEmail inválido."),
  valorTotal: z.number().nonnegative("valorTotal não pode ser negativo."),
  itens: z.array(itemEmailSchema).min(1, "itens não pode ser vazio."),
});
export type PedidoCriadoDados = z.infer<typeof pedidoCriadoDadosSchema>;

export const estoqueInsuficienteDadosSchema = z.object({
  clienteEmail: z.string().email("clienteEmail inválido."),
  motivo: z.string().min(1, "motivo é obrigatório."),
});
export type EstoqueInsuficienteDados = z.infer<typeof estoqueInsuficienteDadosSchema>;
```

---

## 5. Interface de `src/config/kafka.ts` (igual em cada serviço, sem import entre serviços)

```ts
// Cliente único por processo: new Kafka({ clientId: "<servico>", brokers: env.KAFKA_BROKERS })
export async function garantirTopicos(): Promise<void>;          // listTopics + createTopics([pedidos, estoque], numPartitions 3, replicationFactor 1); "já existe" não é erro
export async function conectarProducer(): Promise<void>;         // pedidos e catalogo; notificacoes não tem producer
export async function publicar<TDados>(
  topico: Topico,
  tipo: string,
  pedidoId: string,
  dados: TDados,
  correlationId: string
): Promise<Envelope<TDados>>;                                     // key = pedidoId, value = JSON.stringify(envelope); log "[correlationId=…] publicado <tipo> pedidoId=<id> topico=<t>"
export type HandlerEvento = (evento: EnvelopeRecebido) => Promise<void>;
export async function iniciarConsumer(
  groupId: string,
  topicos: Topico[],
  handlers: Partial<Record<string, HandlerEvento>>
): Promise<void>;                                                 // subscribe fromBeginning true; eachMessage: JSON.parse → envelopeRecebidoSchema → handlers[tipo] (ausente = return) → await handler
export async function desconectarKafka(): Promise<void>;          // consumer.disconnect() + producer.disconnect()
```

Logs (RF08), formato único `[correlationId=<id>]`:
- `[correlationId=…] publicado pedido.criado pedidoId=… topico=pedidos`
- `[correlationId=…] recebido estoque.reservado pedidoId=… → AGUARDANDO_PAGAMENTO`
- `[correlationId=…] evento repetido ignorado pedido.criado pedidoId=…`
- `[correlationId=-] evento inválido descartado topico=… offset=…: <detalhes Zod>`
- `[correlationId=…] falha ao publicar pedido.criado pedidoId=… (pedido gravado, ficará em AGUARDANDO_ESTOQUE)`

---

## 6. Variáveis de ambiente novas (lidas só em `src/config/env.ts`)
| Nome | Serviço | Default no `env.ts` | Valor no compose | Formato |
|---|---|---|---|---|
| `KAFKA_BROKERS` | pedidos, catalogo, notificacoes | `kafka:9092` | `kafka:9092` | lista separada por vírgula → `string[]` (`split(",").map(trim).filter(Boolean)`) |
| `SMTP_HOST` | notificacoes | `mailpit` | `mailpit` | texto |
| `SMTP_PORT` | notificacoes | `1025` | `1025` | inteiro (`parseInt`) |
| `MAIL_FROM` | notificacoes | `Loja <nao-responda@loja.com>` | `Loja <nao-responda@loja.com>` | texto |

`.env.example` da raiz: sem variável nova (nada secreto).

## 7. Entradas no `docker-compose.yml`
| Serviço | Imagem/build | Portas | Depende de | Observações |
|---|---|---|---|---|
| `kafka` | `apache/kafka:3.8.0` | **nenhuma** | — | KRaft broker+controller, healthcheck `kafka-topics.sh --list`, volume `kafka_data:/var/lib/kafka/data`, `KAFKA_LOG_DIRS`, `CLUSTER_ID` fixo, `KAFKA_NUM_PARTITIONS: 3` |
| `kafka-ui` | `kafbat/kafka-ui:v1.1.0` | `8090:8080` | kafka (healthy) | exceção de porta (ADR 007) |
| `mailpit` | `axllent/mailpit` | `8025:8025` | — | SMTP 1025 só na rede interna |
| `notificacoes` | build `./notificacoes` | **nenhuma** | kafka (healthy), mailpit (started) | `stop_grace_period: 10s` |
| `pedidos` (alterado) | — | — | + kafka (healthy) | + `KAFKA_BROKERS`, `stop_grace_period: 10s` |
| `catalogo` (alterado) | — | — | + kafka (healthy) | + `KAFKA_BROKERS`, `stop_grace_period: 10s` |
| volumes | + `kafka_data` | | | |

`gateway.depends_on` não muda (`notificacoes` não tem rota).

## 8. Códigos de erro de domínio
Nenhum novo no HTTP. Nos consumers não há resposta HTTP: erros viram log (validação → descarte; infraestrutura → retry).
