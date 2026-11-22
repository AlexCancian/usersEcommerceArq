# Contrato: observabilidade-cache (aula 10, entrega final)
Data: 22/11/2026
Modo: projeto único `aulas-ecommerce` (um `.git`, uma pasta por serviço, nenhum serviço importa código de outro)
Schemas: Zod/TS escritos aqui, por serviço; cada serviço cria a sua cópia em `src/utils/health.ts` (não existe `src/shared/schemas/`)
Formato de erro: `{ "erro": string, "detalhes"?: string[] }` em tudo, **exceto** o `GET /health`, que sempre responde `{ servico, status, dependencias }` (200 ou 503, slide "HEALTH CHECK")

> Fonte da verdade da feature. Somente o arquiteto altera. Nenhuma rota de negócio muda de forma ou status; esta entrega acrescenta `/health` novo, o cabeçalho `X-Cache`, o Redis, healthchecks e o formato de log.

---

## 1. `GET /health` (RF01, RF02 · RN01–RN03)

### 1.1 Rotas
| Serviço | Interno (Docker healthcheck) | Pelo Kong (`http://localhost:8080`) | Acesso | Status |
|---|---|---|---|---|
| usuarios | `http://127.0.0.1:3000/health` | `GET /health/usuarios` | publico | 200 · 503 |
| catalogo | `http://127.0.0.1:3000/health` | `GET /health/catalogo` | publico | 200 · 503 |
| pedidos | `http://127.0.0.1:3000/health` | `GET /health/pedidos` | publico | 200 · 503 |
| pagamentos | `http://127.0.0.1:3000/health` | `GET /health/pagamentos` | publico | 200 · 503 |
| notificacoes | `http://127.0.0.1:3000/health` (`node:http`, sem Express) | `GET /health/notificacoes` (**nova**) | publico | 200 · 503 |
| banco-falso | `http://127.0.0.1:3000/health` | fora do Kong; host: `http://localhost:9000/health` | — | 200 |

Regras comuns:
- Só `GET /health` exato. Sem `/health/live` e `/health/ready` (D07).
- Cabeçalhos da resposta: `Content-Type: application/json` e `Cache-Control: no-store`.
- **Nunca** chama o `/health` (nem outra rota) de outro serviço (RN01). Pedidos não olha o catálogo; pagamentos não chama o banco-falso (o circuito é lido da memória).
- Cada verificação de dependência tem limite de **2000 ms** e todas rodam em **paralelo** (`Promise.all`); resposta total < 2500 ms (o Docker corta em 3 s).
- Verificação que lança ou estoura o limite = `"fora"`. O handler **nunca** lança (nunca cai no `errorHandler`, nunca 500).
- Sem versão, host, stack, mensagem de banco ou latência no corpo.
- Fora do log de requisições (seção 3.3).

### 1.2 Como cada dependência é testada
| Chave | Serviço(s) | Teste real | Limite | Reaproveitamento |
|---|---|---|---|---|
| `banco` (Postgres) | usuarios, pedidos, pagamentos | `prisma.$queryRaw\`SELECT 1\`` | 2000 ms | não (barato) |
| `banco` (Mongo) | catalogo | `readyState === 1` **e** `mongoose.connection.db.admin().ping()` | 2000 ms | não |
| `kafka` | catalogo, pedidos, pagamentos, notificacoes | admin dedicado ao health (`kafka.admin({ retry: { retries: 0 } })`), `connect()` + `describeCluster()` | 2000 ms | resultado vale **5 s**; chamadas simultâneas compartilham a mesma promessa |
| `cache` | catalogo | `redis.ping()` (falha rápida pelo `commandTimeout` de 200 ms do cliente) | 2000 ms | não |
| `smtp` | notificacoes | `smtp.verify()` (nodemailer) | 2000 ms | resultado vale **5 s**; promessa compartilhada |
| `circuitoBancoCartao` | pagamentos | `estadoCircuito()` em memória (opossum) | — | — |

### 1.3 Regra de status
```
status = "fora do ar"  se alguma dependência ESSENCIAL = "fora"           → HTTP 503
status = "degradado"   se não, e alguma dependência NÃO essencial estiver ruim → HTTP 200
status = "ok"          caso contrário                                      → HTTP 200
```
| Serviço | Essenciais | Não essenciais (→ degradado) |
|---|---|---|
| usuarios | `banco` | — |
| catalogo | `banco`, `kafka` | `cache = "fora"` |
| pedidos | `banco`, `kafka` | — |
| pagamentos | `banco`, `kafka` | `circuitoBancoCartao` = `ABERTO` ou `MEIO-ABERTO` |
| notificacoes | `kafka` | `smtp = "fora"` |
| banco-falso | — | — (sempre `ok`, `dependencias: {}`) |

### 1.4 Schemas (cada serviço copia o seu bloco em `src/utils/health.ts`)
```ts
import { z } from "zod";

// ---- comum (repetido em cada serviço)
export const estadoDependenciaSchema = z.enum(["ok", "fora"]);
export const statusHealthSchema = z.enum(["ok", "degradado", "fora do ar"]);
export type EstadoDependencia = z.infer<typeof estadoDependenciaSchema>;
export type StatusHealth = z.infer<typeof statusHealthSchema>;

// Corta a promessa em `ms`; o timer não segura o processo.
export async function comLimite<T>(promessa: Promise<T>, ms: number): Promise<T>;
// Executa o teste com limite; qualquer erro ou estouro = "fora". Nunca lança.
export async function verificar(teste: () => Promise<unknown>, ms?: number): Promise<EstadoDependencia>; // ms padrão 2000
// HTTP do status: 503 só para "fora do ar".
export function httpDoStatus(status: StatusHealth): 200 | 503;

// ---- usuarios
export const healthUsuariosSchema = z.object({
  servico: z.literal("usuarios"),
  status: statusHealthSchema,
  dependencias: z.object({ banco: estadoDependenciaSchema }).strict(),
}).strict();
export type HealthUsuarios = z.infer<typeof healthUsuariosSchema>;

// ---- catalogo
export const healthCatalogoSchema = z.object({
  servico: z.literal("catalogo"),
  status: statusHealthSchema,
  dependencias: z.object({
    banco: estadoDependenciaSchema,
    kafka: estadoDependenciaSchema,
    cache: estadoDependenciaSchema,
  }).strict(),
}).strict();
export type HealthCatalogo = z.infer<typeof healthCatalogoSchema>;

// ---- pedidos
export const healthPedidosSchema = z.object({
  servico: z.literal("pedidos"),
  status: statusHealthSchema,
  dependencias: z.object({
    banco: estadoDependenciaSchema,
    kafka: estadoDependenciaSchema,
  }).strict(),
}).strict();
export type HealthPedidos = z.infer<typeof healthPedidosSchema>;

// ---- pagamentos
export const estadoCircuitoSchema = z.enum(["FECHADO", "ABERTO", "MEIO-ABERTO"]);
export type EstadoCircuito = z.infer<typeof estadoCircuitoSchema>;
export const healthPagamentosSchema = z.object({
  servico: z.literal("pagamentos"),
  status: statusHealthSchema,
  dependencias: z.object({
    banco: estadoDependenciaSchema,
    kafka: estadoDependenciaSchema,
    circuitoBancoCartao: estadoCircuitoSchema,
  }).strict(),
}).strict();
export type HealthPagamentos = z.infer<typeof healthPagamentosSchema>;

// ---- notificacoes
export const healthNotificacoesSchema = z.object({
  servico: z.literal("notificacoes"),
  status: statusHealthSchema,
  dependencias: z.object({
    kafka: estadoDependenciaSchema,
    smtp: estadoDependenciaSchema,
  }).strict(),
}).strict();
export type HealthNotificacoes = z.infer<typeof healthNotificacoesSchema>;

// ---- banco-falso
export const healthBancoFalsoSchema = z.object({
  servico: z.literal("banco-falso"),
  status: z.literal("ok"),
  dependencias: z.object({}).strict(),
}).strict();
export type HealthBancoFalso = z.infer<typeof healthBancoFalsoSchema>;
```
Os schemas documentam a resposta; o serviço monta o objeto com o tipo (`satisfies HealthCatalogo`), sem `safeParse` em tempo de execução. `notificacoes` não tem `zod` no `package.json`: lá o bloco vira só tipos TS (`type EstadoDependencia = "ok" | "fora"` etc.), sem dependência nova.

### 1.5 Exemplos por serviço
**usuarios**
```http
200 {"servico":"usuarios","status":"ok","dependencias":{"banco":"ok"}}
503 {"servico":"usuarios","status":"fora do ar","dependencias":{"banco":"fora"}}
```
(degradado: não existe para usuarios)

**catalogo**
```http
200 {"servico":"catalogo","status":"ok","dependencias":{"banco":"ok","kafka":"ok","cache":"ok"}}
200 {"servico":"catalogo","status":"degradado","dependencias":{"banco":"ok","kafka":"ok","cache":"fora"}}
503 {"servico":"catalogo","status":"fora do ar","dependencias":{"banco":"fora","kafka":"ok","cache":"ok"}}
```

**pedidos**
```http
200 {"servico":"pedidos","status":"ok","dependencias":{"banco":"ok","kafka":"ok"}}
503 {"servico":"pedidos","status":"fora do ar","dependencias":{"banco":"ok","kafka":"fora"}}
```
(degradado: não existe; catálogo fora aparece como 503 no checkout, não aqui)

**pagamentos**
```http
200 {"servico":"pagamentos","status":"ok","dependencias":{"banco":"ok","kafka":"ok","circuitoBancoCartao":"FECHADO"}}
200 {"servico":"pagamentos","status":"degradado","dependencias":{"banco":"ok","kafka":"ok","circuitoBancoCartao":"ABERTO"}}
200 {"servico":"pagamentos","status":"degradado","dependencias":{"banco":"ok","kafka":"ok","circuitoBancoCartao":"MEIO-ABERTO"}}
503 {"servico":"pagamentos","status":"fora do ar","dependencias":{"banco":"fora","kafka":"ok","circuitoBancoCartao":"FECHADO"}}
```

**notificacoes**
```http
200 {"servico":"notificacoes","status":"ok","dependencias":{"kafka":"ok","smtp":"ok"}}
200 {"servico":"notificacoes","status":"degradado","dependencias":{"kafka":"ok","smtp":"fora"}}
503 {"servico":"notificacoes","status":"fora do ar","dependencias":{"kafka":"fora","smtp":"ok"}}
```
Qualquer outro caminho/método no HTTP mínimo de notificacoes: `404 {"erro":"Rota não encontrada."}`.

**banco-falso**
```http
200 {"servico":"banco-falso","status":"ok","dependencias":{}}
```
(Latência e falhas continuam em `GET /config`; saem do `/health`.)

### 1.6 Pagamentos: circuito
`pagamentos/src/banco.ts` → `estadoCircuito(): "FECHADO" | "ABERTO" | "MEIO-ABERTO"` (D05). Chave no JSON: `circuitoBancoCartao`. `circuitoBancoExterno` deixa de existir.

---

## 2. Cache Redis na vitrine (RF06–RF08 · RN06–RN08)

### 2.1 Cabeçalho `X-Cache` por rota (catálogo; passa pelo Kong sem configuração)
| Rota | Acesso | Usa cache | `X-Cache` | Corpo/status |
|---|---|---|---|---|
| `GET /produtos` (sem `ids`; com ou sem `categoria`/`busca`) | publico | sim | `HIT` \| `MISS` \| `OFF` | inalterado (200, lista) · 400 sem cabeçalho |
| `GET /produtos?ids=a,b` (com ou sem outros filtros: `ids` vence) | publico (usado pelo pedidos pela rede interna) | **não** (D06) | **ausente** | inalterado |
| `GET /produtos/:id` (id ou SKU) → 200 | publico | sim | `HIT` \| `MISS` \| `OFF` | inalterado |
| `GET /produtos/:id` → 404 / 400 | publico | não grava | **ausente** | `{ erro }` inalterado |
| `GET /categorias` | publico | sim | `HIT` \| `MISS` \| `OFF` | inalterado |
| `POST/PUT/PATCH/DELETE /produtos...`, `POST /categorias` | admin | não; **invalidam** | ausente | inalterado |
| Qualquer rota de pedidos, carrinho, pagamentos | — | **nunca** | ausente | inalterado |

Significado: `HIT` = corpo veio do Redis · `MISS` = veio do Mongo e foi gravado · `OFF` = Redis indisponível (ou falhou no `GET`/`SET`), corpo veio do Mongo.
O corpo em `HIT`, `MISS` e `OFF` é **byte a byte o mesmo JSON** que a rota devolve hoje (A08).

### 2.2 Chaves e TTL
| Chave | Valor | TTL | Escrita | Leitura |
|---|---|---|---|---|
| `catalogo:versao` | inteiro; ausente = `0` | **sem TTL** (único contador; o Redis não persiste) | `INCR` | `GET` antes de toda leitura cacheada |
| `catalogo:v<N>:produtos:todos` | JSON exato de `GET /produtos` sem filtro | `CACHE_TTL_SEGUNDOS` + 0..9 s aleatórios | `SET ... EX` | `GET` |
| `catalogo:v<N>:produtos:categoria=<c>&busca=<b>` | JSON exato de `GET /produtos` filtrado | idem | idem | idem |
| `catalogo:v<N>:produto:<idOuSku>` | JSON exato de `GET /produtos/:id` (só 200) | idem | idem | idem |
| `catalogo:v<N>:categorias` | JSON exato de `GET /categorias` | idem | idem | idem |

Normalização (feita **no service**, e os mesmos valores normalizados vão para a consulta ao Mongo, para chave e resultado nunca divergirem):
- `categoria`: `trim()` + `toLowerCase()`; vazia = ausente.
- `busca`: `trim()` + `toLowerCase()` (o repositório já usa `$options: "i"`); vazia = ausente; na chave entra com `encodeURIComponent`.
- Ambos ausentes → `produtos:todos`. Um ausente → valor vazio na chave (ex.: `catalogo:v3:produtos:categoria=livros&busca=`).
- `:id`: o parâmetro como veio (`encodeURIComponent`); id e SKU do mesmo produto são chaves diferentes, ambas invalidadas pela versão.

Exemplos: `catalogo:v7:produtos:categoria=roupas&busca=` · `catalogo:v7:produtos:categoria=&busca=camiseta` · `catalogo:v7:produto:CEL-001` · `catalogo:v7:categorias`.

### 2.3 Interface do `catalogo/src/services/cache.service.ts`
```ts
export type EstadoCache = "HIT" | "MISS" | "OFF";
export interface ResultadoCache {
  json: string;        // corpo exato a enviar
  cache: EstadoCache;  // vira o cabeçalho X-Cache
}
export interface ContextoEvento {
  pedidoId: string;
  correlationId: string;
}

// Cache-aside com versão. `buscar` roda no máximo UMA vez; erro dele sobe (ex.: NotFoundError → 404, nada gravado).
// `sufixo` é a parte depois de "catalogo:v<N>:" (ex.: "categorias", "produto:CEL-001").
export function lerOuBuscar(sufixo: string, buscar: () => Promise<unknown>): Promise<ResultadoCache>;

// INCR catalogo:versao. Nunca lança: erro do Redis vira log de aviso (com pedidoId/correlationId se houver).
export function invalidarVitrine(motivo: string, contexto?: ContextoEvento): Promise<void>;

// Para o health: PING com o commandTimeout curto do cliente.
export function redisDisponivel(): Promise<boolean>;
```

Algoritmo de `lerOuBuscar` (slide "O PADRÃO CACHE-ASIDE" + "VERSÃO NA PRÁTICA", com A06):
1. Em `try` (só Redis): `versao = Number(await redis.get("catalogo:versao") ?? 0)`; `chave = catalogo:v${versao}:${sufixo}`; `guardado = await redis.get(chave)`. Achou → `{ json: guardado, cache: "HIT" }`.
2. Erro no passo 1 → `valor = await buscar()` → `{ json: JSON.stringify(valor), cache: "OFF" }`.
3. Não achou → `valor = await buscar()` (fora de qualquer `try` do Redis; erro sobe); `json = JSON.stringify(valor)`.
4. Em `try` (só Redis): `await redis.set(chave, json, "EX", ttlComVariacao())` → `{ json, cache: "MISS" }`. Erro → `{ json, cache: "OFF" }`.
5. Recomendado (stampede): `Map<string, Promise<ResultadoCache>>` para coalescer MISS simultâneos da mesma chave; quem esperou recebe o mesmo `json` com `cache: "MISS"`.

Regras:
- A versão é lida **antes** do Mongo; o `INCR` é feito **depois** da escrita bem-sucedida no Mongo (spec, "Concorrência").
- Erro de validação (400) e 404 nunca são gravados (o `buscar` lança antes do `SET`).

### 2.4 Pontos de invalidação (`invalidarVitrine`, uma vez por operação, nunca por item)
| Onde | Quando | Motivo (texto do log) |
|---|---|---|
| `createProdutoService` | depois do `createProduto` | `produto criado` |
| `updateProdutoService` | depois do `updateProdutoById` com sucesso | `produto alterado` |
| `ajustarEstoqueService` | depois do `updateEstoqueById` com sucesso | `estoque ajustado` |
| `desativarProdutoService` | depois do `softDeleteProdutoById` com sucesso | `produto desativado` |
| `createCategoriaService` | depois do `createCategoria` | `categoria criada` |
| `reservarEstoqueDoPedidoService` | só no caminho de sucesso, depois do `concluirReserva(..., "reservado")` e **antes** do `publicar` | `estoque reservado` + contexto |
| `confirmarReservaService` | depois do laço `confirmarSaidaDoEstoque` | `reserva confirmada` + contexto |
| `liberarReservaService` | depois do laço de devolução | `estoque devolvido` + contexto |
| Subida do catálogo (`index.ts`) | depois de `connectDatabase()`, aguardando `ready` do Redis por até 2 s (A02) | `subida do catálogo` |

Não invalidam: caminho `estoque.insuficiente` (o que foi tirado volta no mesmo evento: líquido zero), eventos repetidos/ignorados, erros (409/404/400).

### 2.5 Cliente Redis (`catalogo/src/config/redis.ts`, ioredis 5)
| Opção | Valor | Por quê |
|---|---|---|
| URL | `env.REDIS_URL` | padrão `redis://redis:6379` |
| `enableOfflineQueue` | `false` | sem conexão, o comando falha na hora (não enfileira a requisição) |
| `maxRetriesPerRequest` | `0` | comando não é repetido quando a conexão cai |
| `commandTimeout` | `200` ms | Redis lento = `OFF`, não trava a vitrine |
| `connectTimeout` | `1000` ms | |
| `retryStrategy` | `(n) => Math.min(n * 500, 5000)` | reconecta em segundo plano para sempre |
| eventos | `error` e `ready` com log só na **transição** (`cache indisponível` / `cache disponível`) | sem inundar o log a cada tentativa; sem "Unhandled error event" |
| import | `import { Redis } from "ioredis";` | export nomeado (ESM/NodeNext) |
| desligar | `quit()` com fallback `disconnect()` no `encerrar()` | |

Falha de conexão na subida **não** derruba o catálogo (o `startServer` não espera o Redis além dos 2 s do A02 e nunca lança por ele).

### 2.6 Variáveis de ambiente novas (catálogo)
| Nome | Leitura em `catalogo/src/config/env.ts` | Padrão | Compose |
|---|---|---|---|
| `REDIS_URL` | `process.env.REDIS_URL \|\| "redis://redis:6379"` | `redis://redis:6379` | `REDIS_URL: redis://redis:6379` |
| `CACHE_TTL_SEGUNDOS` | inteiro ≥ 1; inválido/ausente → 60 | `60` | `CACHE_TTL_SEGUNDOS: 60` |

---

## 3. Logs (RF04, RF05 · RN04, RN05)

### 3.1 Formato padronizado das linhas de evento
```
[<servico>] <verbo> <tipo> pedidoId=<uuid|-> correlationId=<id|-> [chave=valor ...]
```
- `<servico>` = nome da pasta (`pedidos`, `catalogo`, `pagamentos`, `notificacoes`). Necessário porque o grep da aula usa `--no-log-prefix`.
- `<tipo>` = tipo do evento (`pedido.criado`, `estoque.reservado`, ...).
- Campos extras em `chave=valor`, sem espaços no valor (usar `-` ou aspas não; textos livres vão no fim como `motivo="..."` truncado em 200 caracteres).

| Verbo | Quando | Onde (um ponto só) | Extras |
|---|---|---|---|
| `publicou` | depois do `producer.send` | `publicar()` em `*/src/config/kafka.ts` | `topico=` |
| `recebeu` | envelope válido **com handler** (A09), antes de tratar | `iniciarConsumer()` em `*/src/config/kafka.ts` | `topico= particao= offset=` |
| `processou` | efeito aplicado (status novo, reserva feita/confirmada, cobrança, e-mail) | services | `status=` / `resultado=` |
| `compensou` | compensação da saga | services (catálogo devolve estoque; pedidos cancela por recusa; pagamentos estorna) | `acao=` (`estoque-devolvido`, `pedido-cancelado`, `estornado`) |
| `ignorou` | evento repetido ou fora de estado | services | `motivo=` |
| `descartou` | envelope inválido (sem DLQ) | `iniciarConsumer()` | `topico= offset= motivo=`; `pedidoId`/`correlationId` extraídos do JSON bruto se forem strings, senão `-` |
| `falhou` | erro ao tratar (será reentregue) / falha ao publicar / invalidação de cache | `iniciarConsumer()`, services, `cache.service` | `erro=<descrição saneada>` |

Exemplo de uma compra (`docker compose logs -t --no-log-prefix | grep 6f1c... | sort`):
```
[pedidos] HTTP POST /pedidos 202 148ms correlationId=6f1c...
[catalogo] HTTP GET /produtos 200 9ms correlationId=6f1c...
[pedidos] publicou pedido.criado pedidoId=2b7e... correlationId=6f1c... topico=pedidos
[catalogo] recebeu pedido.criado pedidoId=2b7e... correlationId=6f1c... topico=pedidos particao=1 offset=12
[catalogo] publicou estoque.reservado pedidoId=2b7e... correlationId=6f1c... topico=estoque
[notificacoes] recebeu pedido.criado pedidoId=2b7e... correlationId=6f1c... topico=pedidos particao=1 offset=12
[pedidos] recebeu estoque.reservado pedidoId=2b7e... correlationId=6f1c... topico=estoque particao=1 offset=9
[pedidos] processou estoque.reservado pedidoId=2b7e... correlationId=6f1c... status=AGUARDANDO_PAGAMENTO
[pagamentos] recebeu estoque.reservado pedidoId=2b7e... correlationId=6f1c... topico=estoque particao=1 offset=9
[banco-falso] HTTP POST /cobrancas 201 3ms correlationId=6f1c...
[pagamentos] publicou pagamento.aprovado pedidoId=2b7e... correlationId=6f1c... topico=pagamentos
[catalogo] recebeu pagamento.aprovado pedidoId=2b7e... correlationId=6f1c... topico=pagamentos particao=1 offset=4
[pedidos] processou pagamento.aprovado pedidoId=2b7e... correlationId=6f1c... status=PAGO
[notificacoes] processou pagamento.aprovado pedidoId=2b7e... correlationId=6f1c... resultado=email-enviado
```
Compensações: `[catalogo] compensou pagamento.recusado pedidoId=... correlationId=... acao=estoque-devolvido itens=1` · `[pedidos] compensou pagamento.recusado pedidoId=... correlationId=... acao=pedido-cancelado` · `[pagamentos] compensou pedido.cancelado pedidoId=... correlationId=... acao=estornado codigo=TX-...`.

Linhas operacionais já existentes que têm `[correlationId=...]` e `pedidoId=` (ex.: tentativas de cobrança em `pagamentos/src/banco.ts`) podem ficar como estão; ao mexer nelas, adotar o prefixo `[<servico>]`.

### 3.2 Helper por serviço (`src/utils/log.ts`, sem dependência nova)
```ts
export type VerboEvento =
  | "publicou" | "recebeu" | "processou" | "compensou" | "ignorou" | "descartou" | "falhou";

// Monta e imprime a linha da seção 3.1 (console.log; "falhou" e "descartou" em console.error).
export function logEvento(
  verbo: VerboEvento,
  tipo: string,
  pedidoId: string | null,
  correlationId: string | null,
  extras?: Record<string, string | number>
): void;

// Descrição segura de um erro (A03, A04):
// - tem `code` (Prisma, Mongo, Kafka, nodemailer, rede) → "<name> code=<code>" (+ " responseCode=<n>" se houver)
// - senão → "<name>: <message>" truncado em 200 caracteres, sem quebras de linha
// - não-Error → "erro desconhecido"
export function descreverErro(erro: unknown): string;

// X-Request-Id aceito só se casar com /^[A-Za-z0-9-]{1,64}$/ (A05); senão undefined.
export function lerRequestId(valor: string | undefined): string | undefined;
```
Serviços sem Kafka (usuarios, banco-falso) só têm `descreverErro` e `lerRequestId`. Em notificacoes, `descreverErro` **nunca** inclui `message` (A03).

### 3.3 Log de requisição HTTP (`src/middleware/requestLog.ts`)
Serviços: usuarios, catalogo, pedidos, pagamentos, banco-falso (notificacoes não loga o próprio `/health`, que é sua única rota).
```
[<servico>] HTTP <METODO> <caminho> <status> <duracao>ms correlationId=<id|->
```
- Registrado no `index.ts` **antes** do `express.json()` e das rotas; imprime no `res.on("finish")`.
- `caminho` = `req.path` (sem query string: `busca` e `ids` não vão ao log).
- Pula quando `req.path === "/health"` ou começa com `/health/` (RN04: o Docker chama a cada 10 s).
- Nunca imprime corpo, cabeçalhos (exceto o id), token ou IP.
- `correlationId` = `lerRequestId(req.header("x-request-id")) ?? "-"`.

### 3.4 Log de erro 500 (todos os `errorHandler`)
```
[<servico>] erro 500 <METODO> <caminho> correlationId=<id|-> erro=<descreverErro(err)>
```
Substitui `console.error("...", err)` em `usuarios/src/middleware/errorHandler.ts:50`, `catalogo/src/middleware/errorHandler.ts:59`, `pedidos/src/middleware/errorHandler.ts:48-51`, `pagamentos/src/middleware/errorHandler.ts:48`, `banco-falso/src/middleware/errorHandler.ts:21-24`. Resposta continua `{ "erro": "Erro interno do servidor." }`.

### 3.5 Proibido em qualquer log
Senha, `senha_hash`, token JWT/cabeçalho `Authorization`, número de cartão (só `cartaoFinal` de 4 dígitos é permitido), CPF, e-mail de cliente (inclusive `clienteEmail` do envelope e destinatários de SMTP), corpo de requisição, mensagem crua de erro do Prisma/Mongo/nodemailer, objeto de erro inteiro. Seed de usuarios: logar o perfil (`admin`/`cliente`), não o e-mail.

---

## 4. Docker Compose (RF03, RF08 · RN09)

### 4.1 Healthcheck dos serviços de aplicação (usuarios, catalogo, pedidos, pagamentos, notificacoes, banco-falso)
```yaml
healthcheck:
  test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/health',{signal:AbortSignal.timeout(2500)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
  interval: 10s
  timeout: 3s
  retries: 3
  start_period: 40s
```
200 (`ok` ou `degradado`) = healthy; 503 ou sem resposta = falha. Três falhas seguidas (≈ 30 s) = `unhealthy` (slide "O DOCKER DE OLHO"). O Docker só marca, não reinicia.

### 4.2 Healthcheck da infraestrutura
| Serviço | `test` | interval | timeout | retries | start_period |
|---|---|---|---|---|---|
| gateway | `["CMD", "kong", "health"]` | 10s | 5s | 3 | 20s |
| mongo-catalogo | `["CMD", "mongosh", "--quiet", "--eval", "db.adminCommand('ping').ok"]` | 10s | 5s | 5 | 20s |
| redis | `["CMD", "redis-cli", "ping"]` | 5s | 3s | 5 | 5s |
| mailpit | `["CMD", "/mailpit", "readyz"]` | 10s | 3s | 3 | 5s |
| postgres-* | inalterado (`pg_isready`, 5s/5s/5) | | | | |
| kafka | inalterado (10s/10s/10, start_period 30s) | | | | |
| kafka-ui | sem healthcheck (ferramenta; ninguém depende dela) | | | | |

### 4.3 `depends_on` (todas com `condition: service_healthy`)
| Serviço | Depende de |
|---|---|
| usuarios | postgres-usuarios (já) |
| catalogo | mongo-catalogo, kafka, redis |
| pedidos | postgres-pedidos, kafka (**remove** catalogo: o checkout já devolve 503) |
| pagamentos | postgres-pagamentos, kafka, banco-falso |
| notificacoes | kafka, mailpit |
| kafka-ui | kafka (já) |
| gateway | usuarios, catalogo, pedidos, pagamentos, notificacoes |

### 4.4 Serviço `redis` (novo)
```yaml
redis:
  image: redis:7-alpine
  container_name: ecommerce-redis
  restart: unless-stopped
  command: ["redis-server", "--save", "", "--appendonly", "no", "--maxmemory", "64mb", "--maxmemory-policy", "volatile-lru"]
  healthcheck: (tabela 4.2)
  networks: [ecommerce-net]
```
Sem `ports`, sem `volumes` nomeados (A01: `volatile-lru` protege `catalogo:versao`).

### 4.5 Ambiente novo
- catalogo: `REDIS_URL: redis://redis:6379`, `CACHE_TTL_SEGUNDOS: 60`.
- notificacoes: `PORT: 3000`.
- Nenhuma porta publicada nova. Nenhuma variável obrigatória (todas com padrão).

---

## 5. Kong (RF02)
Rota nova em `kong/kong.yml`, no mesmo modelo das outras de health:
```yaml
  - name: notificacoes-health # GET /health/notificacoes → notificacoes:3000/health (sem rota de negócio)
    url: http://notificacoes:3000/health
    routes:
      - name: health-notificacoes
        methods: [GET]
        paths: ["/health/notificacoes"]
        strip_path: true
        tags: [publico]
```
| Método | Rota | Acesso | Upstream | Status |
|---|---|---|---|---|
| GET | `/health/notificacoes` | publico | `notificacoes:3000/health` | 200 · 503 · 502/503 do Kong se o container estiver parado |

Inalteradas: `/health/usuarios`, `/health/catalogo`, `/health/pedidos`, `/health/pagamentos` (só o corpo muda). `X-Cache` atravessa a rota `vitrine` sem plugin. Opcional (fora do mínimo): log de acesso do Kong com `$http_x_request_id`.

---

## 6. Arquivos `.http` (RF09)

### 6.1 `http/fluxo-completo.http` (único arquivo em `http/`; tudo por `# @name`, nada fixo)
`@baseUrl = http://localhost:8080` · `@bancoUrl = http://localhost:9000`
| # | Requisição | Esperado |
|---|---|---|
| 0 | `POST {{bancoUrl}}/config {"latenciaMs":0,"falhaPercent":0}` | 200 (garante repetição) |
| 1 | `# @name login` `POST /auth/login` cliente do seed | 200 `{ token }` |
| 2 | `# @name vitrine` `GET /produtos?categoria=livros` | 200 + `X-Cache`; `@produto = {{vitrine.response.body.$[0]._id}}` |
| 3 | `POST /carrinho/itens {"produto_id":"{{produto}}","quantidade":1}` | 201 |
| 4 | `# @name checkout` `POST /pedidos` pix | 202 `AGUARDANDO_ESTOQUE`; anotar `X-Request-Id` da resposta |
| 5 | `GET /pedidos/{{checkout.response.body.id}}` (reenviar até `PAGO`) | 200 `PAGO` |
| 6 | `GET /pagamentos/{{...id}}` | 200 `APROVADO` |
| 7 | `GET /produtos/{{produto}}` | estoque antes do cenário 0002 |
| 8–10 | carrinho + checkout cartão `4000000000000002` + GET pedido até `CANCELADO` | 202 → `CANCELADO` com `motivo_cancelamento` |
| 11 | `GET /produtos/{{produto}}` | `disponivel` igual ao passo 7 |
| 12 | `POST {{bancoUrl}}/config {"latenciaMs":1500}` (A07) | 200 |
| 13–15 | carrinho + checkout cartão `4111111111111111` + `POST /pedidos/:id/cancelar` logo em seguida | 202 → 200 `CANCELADO` (409 = demorou; repetir) |
| 16 | `GET /pagamentos/:id` (reenviar até estabilizar) | `ESTORNADO` ou `CANCELADO` |
| 17 | `GET /produtos/{{produto}}` | estoque de volta |
| 18 | `POST {{bancoUrl}}/config {"latenciaMs":0}` | 200 |
| 19 | `GET /usuarios` com o token do cliente | **403** |
Cabeçalho do arquivo: como subir, e o comando `docker compose logs -t --no-log-prefix | grep <X-Request-Id> | sort` (PowerShell: `Select-String`).

### 6.2 `requests/observabilidade.http` (demo de health e cache)
Health: `GET /health/{usuarios,catalogo,pedidos,pagamentos,notificacoes}` (200) e `GET {{bancoUrl}}/health`. Cache: `GET /produtos?categoria=roupas` duas vezes (`MISS` → `HIT`), `GET /categorias` (`MISS` → `HIT`), `GET /produtos/<id da vitrine>` (`MISS` → `HIT`), `GET /produtos?ids=<id>` (sem `X-Cache`), login admin + `PUT /produtos/:id` com preço novo (200) + `GET /produtos?categoria=roupas` (`MISS`, preço novo), instruções comentadas para `docker compose stop redis` (→ `X-Cache: OFF`, `/health/catalogo` `degradado` 200) e `docker compose start redis`, `docker compose stop postgres-pagamentos` (→ `/health/pagamentos` 503, `unhealthy` em ~30 s), `falhaPercent: 100` (→ `circuitoBancoCartao: ABERTO`, `degradado` 200). Casos de erro: `GET /produtos/inexistente` 404 sem `X-Cache`; `PUT /produtos/:id` com token de cliente 403; sem token 401.

---

## 7. Status HTTP desta entrega
| Situação | Status | Corpo |
|---|---|---|
| `/health` ok ou degradado | 200 | `{ servico, status, dependencias }` |
| `/health` fora do ar | 503 | `{ servico, status: "fora do ar", dependencias }` |
| Vitrine com Redis fora | 200 | igual ao normal, `X-Cache: OFF` |
| Produto inexistente | 404 | `{ "erro": "Produto não encontrado." }` (inalterado) |
| Demais rotas | inalterado | inalterado |
