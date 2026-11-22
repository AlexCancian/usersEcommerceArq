# Revisão: observabilidade-cache (aula 10, entrega final)
Data: 22/11/2026
Rodada: 1
Veredito: APROVADO

Perfil: `aulas-ecommerce` (CLAUDE.md da raiz, substitui `api-express`). Fonte da verdade: `aulas/texto/10-observabilidade-e-cache.txt` (slides "O QUE ENTREGAR 1/3 a 3/3", "UM README QUE FUNCIONA", "O FLUXO-COMPLETO.HTTP", "TODOS OS REQUISITOS 1/6 a 6/6", "ANTES DE ENTREGAR"). Conferido contra `01-spec.md`, `02-validacao.md` (A01–A09), `03-contrato-api.md` e `04-plano-backend.md`.

## Repositórios revisados
| Repositório | Perfil | Branch base | Arquivos alterados |
|---|---|---|---|
| `usersEcommerceArq` (projeto único) | aulas-ecommerce | `HEAD` (branch `feat/aula-10-observabilidade-cache`; `git diff main...HEAD` vazio, revisado o working tree) | 52 modificados (`git diff --stat`: +1290/−454) + não rastreados: `http/fluxo-completo.http`, `requests/observabilidade.http`, `docs/adr/0001..0012`, `catalogo/src/{config/redis.ts, services/cache.service.ts, middleware/requestLog.ts, utils/health.ts, utils/log.ts}`, `pedidos|pagamentos|usuarios/src/{middleware/requestLog.ts, utils/health.ts, utils/log.ts}`, `notificacoes/src/{health.ts, utils/health.ts, utils/log.ts}`, `banco-falso/src/{middleware/requestLog.ts, utils/log.ts}` |

## Comandos (por serviço)
| Serviço | Comando | Resultado | Resumo |
|---|---|---|---|
| usuarios | `npx prisma validate` | PASSOU | schema válido |
| usuarios | `npx tsc --noEmit` | PASSOU | sem erros |
| usuarios | `npm run build` | PASSOU | `tsc` ok |
| catalogo | `npx tsc --noEmit` | PASSOU | sem erros |
| catalogo | `npm run build` | PASSOU | `tsc` ok; `npm ls ioredis` → 5.11.1 (lock coerente com `npm ci`) |
| pedidos | `npx prisma validate` | PASSOU | precisa de `DATABASE_URL` no ambiente (não há `.env` local; com URL fictícia: válido). Ambiental, não é defeito |
| pedidos | `npx tsc --noEmit` / `npm run build` | PASSOU | sem erros |
| pagamentos | `npx prisma validate` | PASSOU | idem pedidos |
| pagamentos | `npx tsc --noEmit` / `npm run build` | PASSOU | sem erros |
| notificacoes | `npx tsc --noEmit` / `npm run build` | PASSOU | sem erros |
| banco-falso | `npx tsc --noEmit` / `npm run build` | PASSOU | sem erros |
| raiz | `docker compose config --quiet` | PASSOU | exit 0; `--services` = 15 containers, iguais aos do diagrama do README |
| todos | `npm run lint` / `npm test` | N/A | scripts inexistentes no perfil |

Não executado (pendência do usuário, conforme CLAUDE.md): `docker compose down -v && docker compose up -d --build`, `docker compose ps` todos `(healthy)`, rodar `http/fluxo-completo.http` e `requests/observabilidade.http`, teste do clone limpo e tag `entrega-final`.

## Checklist — comum
| # | Item | Resultado | Local |
|---|---|---|---|
| 1 | Todas as RN/RF implementadas | OK | RN01–RN09 / RF01–RF10 conferidos abaixo; RF11 (tag) é pendência do usuário |
| 2 | Rotas, métodos, status e campos idênticos ao contrato | OK | health §1 nos 6 serviços; `X-Cache` §2.1; Kong §5 (`kong/kong.yml:137-146`) |
| 3 | Critérios de aceite dos planos atendidos | OK (estático) | os que dependem de Docker ficam como pendência do usuário |
| 4 | Nenhum `any` / `@ts-ignore` em código novo | OK | grep nas linhas adicionadas e nos arquivos novos: nenhum. `err: any` dos `errorHandler` de usuarios/catalogo é legado não reescrito |
| 5 | Entrada externa validada e env validado | OK | `catalogo/src/config/env.ts:4,16-18` (TTL inteiro ≥ 1, senão 60); `notificacoes/src/config/env.ts:7`; `X-Request-Id` por `lerRequestId` (A05) |
| 6 | JWT | N/A | inalterado |
| 7 | Autorização no servidor | OK | sem mudança; `/health/*` públicos por decisão da aula |
| 8 | Erros sem stack/SQL/mensagem crua do ORM | OK | §3.4 aplicado nos 5 `errorHandler`; Prisma sem `code` → só o nome (`pedidos/src/utils/log.ts:55`, idem usuarios/pagamentos) |
| 9 | Sem segredo/credencial versionado ou logado | OK | seed de usuarios loga perfil (`usuarios/prisma/seed.ts:28-64`); SMTP sem `message` (`notificacoes/src/utils/log.ts`, A03); `e-mail` do envelope nunca logado |
| 10 | Datas/fuso | N/A | sem data de negócio nova |
| 11 | Conflitos em transação | N/A | sem escrita nova de negócio; versão lida antes do Mongo, `INCR` depois da escrita |
| 12 | Efeitos externos sem promise solta | OK | `invalidarVitrine` é aguardada e nunca lança (`catalogo/src/services/cache.service.ts:74-83`) |
| 13 | Sem placeholders / console de debug | OK | logs são operacionais; ver sugestão sobre `listProdutosAtivosService` órfão |

## Checklist — backend (perfil aulas-ecommerce)
| # | Item | Resultado | Local |
|---|---|---|---|
| 14 | Query com `select` / colunas sensíveis | N/A | nenhuma query nova; health usa `SELECT 1` / `ping` |
| 15 | Sem N+1 | OK | invalidação uma vez por operação, não por item (`reserva.service.ts:79,112,146`) |
| 16 | Tipos compatíveis com o driver | OK | Redis só strings; sem schema novo |
| 17 | Migration | N/A | nenhuma migration nova; nenhuma aplicada editada |
| 18 | Controller fino, `AppError` | OK | controllers só setam `X-Cache` e enviam `json` (`produto.controller.ts:33-46,59-64`, `categoria.controller.ts:16-21`) |
| 19 | Rotas registradas / Kong | OK | `/health/notificacoes` com `strip_path: true`, `tags: [publico]` (`kong/kong.yml:139-146`) |
| 20–27 | WhatsApp / frontend | N/A | |

## Conferência por foco pedido

### /health (6 serviços) — OK
- Formato `{ servico, status, dependencias }`, 3 estados, `Cache-Control: no-store`, tipado com `satisfies` do schema: `usuarios/src/controllers/health.controller.ts:8-19`, `catalogo/.../health.controller.ts:12-40`, `pedidos/.../health.controller.ts:10-27`, `pagamentos/.../health.controller.ts:12-32`, `notificacoes/src/health.ts:8-57`, `banco-falso/src/controllers/banco.controller.ts:51-55`.
- 503 só com banco/Kafka fora; cache (catálogo), circuito `ABERTO|MEIO-ABERTO` (pagamentos) e SMTP (notificações) → `degradado` 200. Circuito renomeado para `circuitoBancoCartao` com maiúsculas (`pagamentos/src/banco.ts:140-144`); nenhuma ocorrência de `circuitoBancoExterno` fora de `aulas/` e `docs/features/`.
- Rápido: cada checagem em `verificar()` com limite de 2000 ms e `Promise.all`; Kafka e SMTP com cache de 5 s e promessa compartilhada; Redis via `commandTimeout` 200 ms. Handler nunca lança.
- Não chama outros serviços: pedidos não olha o catálogo; pagamentos lê o circuito em memória.
- Fora do log: `requestLog` pula `/health` e `/health/*` (todos os `src/middleware/requestLog.ts:9`); o `node:http` de notificações não loga requisição.

### Compose (healthcheck / depends_on / subida do zero) — OK (verificação estática)
- Âncora `x-healthcheck-app` (`docker-compose.yml:10-21`): `node -e fetch(...)`, 10s/3s/3/`start_period: 40s`, aplicada nos 6 serviços de aplicação. `node` existe em `node:22-slim` (todos os Dockerfiles), então não depende de `wget`/`curl` que a imagem slim não tem.
- Infra: gateway `kong health` (binário da imagem `kong:3.9`), mongo `mongosh` (presente em `mongo:7-jammy`), redis `redis-cli ping` (presente em `redis:7-alpine`), mailpit `/mailpit readyz` (binário da imagem, mesmo comando do HEALTHCHECK dela). Postgres e Kafka inalterados.
- `depends_on` com `service_healthy` exatamente como §4.3; pedidos não depende mais do catálogo; gateway depende dos 5 serviços expostos (inclui notificacoes) e sobe por último.
- Sem `.env` obrigatório: `REDIS_URL`/`CACHE_TTL_SEGUNDOS` com `${...:-padrão}`; `.env.example` explica que é opcional. Nenhuma porta nova publicada (só 8080/8001/8002, 8090, 8025, 9000).

### Cache Redis no catálogo — OK
- Cache-aside com versão (`catalogo/src/services/cache.service.ts:30-56`): versão lida antes do Mongo; `buscar()` executado no máximo uma vez e fora do `try` do Redis (A06): 404/400 sobem e nada é gravado; falha no `SET` → `OFF`; JSON guardado como texto (A08). TTL `CACHE_TTL_SEGUNDOS + 0..9` (`:23-25`). Coalescência de MISS por chave.
- Rotas: `GET /produtos` (sem `ids`), `GET /produtos/:id` (só 200), `GET /categorias` com `X-Cache`; `?ids=` sem cache e sem cabeçalho (`produto.controller.ts:33-40`, `produto.service.ts:42-45`). Normalização de `categoria`/`busca` vai para a chave e para a consulta (`produto.service.ts:27-38`).
- Invalidação (`INCR catalogo:versao`) depois do sucesso em: create/update/ajustarEstoque/desativar produto (`produto.service.ts:74,99,120,131`), create categoria (`categoria.service.ts:25-26`), reserva (`reserva.service.ts:79`, antes do `publicar`), confirmação (`:112`), devolução (`:146`) e subida do catálogo (`catalogo/src/index.ts:39-43`, com espera de `ready` ≤ 2 s, A02). Caminho `estoque.insuficiente` não invalida (líquido zero), conforme §2.4. Não há outra rota de escrita no catálogo (conferido em `controllers/*.ts`).
- Redis fora não derruba nem trava: `enableOfflineQueue: false`, `maxRetriesPerRequest: 0`, `commandTimeout: 200`, reconexão em segundo plano, listener de `error` (sem "Unhandled error event") com log só na transição (`catalogo/src/config/redis.ts:6-29`); `invalidarVitrine` engole e loga `falhou cache.invalidar` com `pedidoId`/`correlationId`; health `cache: "fora"` → `degradado` 200.
- Sem persistência: `--save ""`, `--appendonly no`, `--maxmemory 64mb`, `volatile-lru` (A01), sem `ports`/volume nomeado (`docker-compose.yml:350-366`).

### Logs e correlationId — OK
- Formato §3.1 por `logEvento` em pedidos, catálogo, pagamentos, notificações: `publicou` (`*/config/kafka.ts` em `publicar`), `recebeu` só com handler (A09), `descartou` com ids extraídos do JSON bruto apenas se forem strings seguras, `falhou` com `descreverErro` (nunca objeto cru), `processou/compensou/ignorou` nos services. Todos com `pedidoId` e `correlationId`.
- Propagação: Kong `correlation-id` (`generator: uuid`, `echo_downstream`) → `lerRequestId` nos controllers de pedidos (`pedido.controller.ts:24,65`, `carrinho.controller.ts:20,36`) → envelope → consumers copiam; pedidos repassa `x-request-id` ao catálogo (`pedidos/src/catalogo.ts:30`) e pagamentos ao banco-falso (`pagamentos/src/banco.ts:72`); log HTTP `[servico] HTTP ...` em usuarios, catalogo, pedidos, pagamentos e banco-falso. O grep pega pelo menos 5 serviços.
- Sem dado sensível: nenhum log com e-mail, cartão completo, token, senha ou corpo; path sem query string.

### `http/fluxo-completo.http` — OK
- Sintaxe REST Client coerente com os `.http` existentes do projeto (`# @name`, `@var ={{req.response.body...}}`, `$[0]._id`). Nada fixo: token, produto e pedidos por `# @name`; único valor "fixo" são as URLs base.
- Ordem: 0 reset do banco → A login → vitrine (`?categoria=livros`) → carrinho → checkout 202 → GET até `PAGO` → pagamento → estoque; B cartão `...0002` → `CANCELADO` com motivo → estoque; C latência 1500 ms (A07) → checkout → cancelar → pagamento `ESTORNADO|CANCELADO` → estoque → latência 0; D cliente em `GET /usuarios` → 403. Corpos batem com `pedidos/src/utils/schemas.ts` (`produto_id`, `endereco_entrega`, `forma_pagamento`, `numero_cartao`).
- `requests/observabilidade.http` cobre §6.2 incluindo 404 sem `X-Cache`, 403 e 401.

### README e ADRs — OK
- Estrutura do slide "UM README QUE FUNCIONA": Subir (um comando, portas, usuários do seed), Arquitetura (Mermaid + tabela de serviços), Rotas com acesso, Eventos, Demonstração (saga, recusa, cancelamento, circuito, health, cache, grep), Decisões → `docs/adr/`, Limitações.
- Diagrama: 15 nós = `docker compose config --services` (gateway, usuarios, catalogo, pedidos, pagamentos, notificacoes, postgres-usuarios, mongo-catalogo, postgres-pedidos, postgres-pagamentos, redis, kafka, kafka-ui, mailpit, banco-falso), tópicos `pedidos/estoque/pagamentos` com produtores e consumidores corretos.
- `docs/adr/`: 12 arquivos, todos com `## Contexto`, `## Decisão`, `## Consequências` (inclui o que se perdeu).

### Kong — OK
`notificacoes-health` → `http://notificacoes:3000/health`, só `GET`, `strip_path: true`, `publico`; sem rota de negócio para notificações (D03).

### Requisitos 1/6–6/6 (regressão) — OK
Nenhuma rota de negócio, status, envelope de evento, tópico, consumer group, seed ou migration mudou. `?ids=` do checkout segue sem cache (preço de agora). JWT, ACL, rate limit, remoção/injeção de `X-User-*` inalterados.

## Bloqueantes
### dev-backend
- Nenhum.

### dev-frontend
- N/A (sem frontend).

### arquiteto (contrato)
- Nenhum.

## Sugestões (não bloqueantes)
- `docker-compose.yml:229-241` — `kafka-ui` sem healthcheck: `docker compose ps` não mostra `(healthy)` para ele, e o slide pede "todos os serviços aparecem healthy". Foi decisão do contrato (§4.2) e o README avisa; se quiser fechar a brecha, um healthcheck simples no `kafka-ui` (conferir antes qual ferramenta a imagem `kafbat/kafka-ui` traz).
- `docker-compose.yml:21` — `start_period: 40s` pode ficar justo na primeira subida em máquina lenta (migrate + seed + Kafka; após o período, 3 falhas ≈ 30 s já marcam `unhealthy` e o `up -d` aborta por `dependency failed`). Validar no teste do clone limpo; se apertar, subir para 60 s.
- `http/fluxo-completo.http:148-193` — o cenário C depende de o cliente enviar o C.4 em ~1,5 s depois do C.3; 409 é provável com clique manual. Está documentado ("repita a partir do C.2") e é o desenho aceito no A07; vale ensaiar antes da apresentação.
- `catalogo/src/services/cache.service.ts:60-70` — a coalescência usa o `sufixo` (sem a versão): uma leitura que chega logo depois de um `INCR`, enquanto um MISS da versão anterior ainda está em andamento, recebe o corpo antigo (não é gravado na versão nova, então não persiste). Coalescer pela chave já versionada eliminaria esse caso.
- `*/src/config/kafka.ts` (`testarKafka`) — se o `connect()` do admin estourar o limite de 2 s e terminar depois do `disconnect()`, pode sobrar uma conexão aberta por tentativa enquanto o Kafka estiver lento. Risco baixo; opcional guardar e encerrar a promessa pendente.
- `catalogo/src/utils/log.ts:45-54` — `descreverErro` do catálogo não trata erros do Mongoose sem `code` (ex.: `ValidationError`), que caem em `name: message` (contém valores do produto, não dado pessoal). Para seguir o A04 ao pé da letra, logar só o nome para `ValidationError`/`CastError`.
- `banco-falso/src/controllers/banco.controller.ts:53` — corpo tipado com `as const` em vez de `satisfies HealthBancoFalso`; o contrato §1.4 previa `src/utils/health.ts` também no banco-falso. Formato da resposta está correto.
- `catalogo/src/services/produto.service.ts:19-23` — `listProdutosAtivosService` ficou sem uso após a troca pelos serviços de vitrine/ids.
- `catalogo/src/index.ts:68`, `pedidos/src/index.ts:53`, `pagamentos/src/index.ts:50`, `notificacoes/src/index.ts:27`, `catalogo/src/config/db.ts:9` — falhas de subida ainda imprimem o objeto de erro inteiro (linhas não alteradas, fora das linhas de evento). Trocar por `descreverErro` deixaria o padrão uniforme.
- `notificacoes/src/health.ts:53` — `server.listen` sem listener de `error` (porta ocupada derruba o processo). O `restart: unless-stopped` cobre; opcional logar e seguir.
- `pagamentos/src/banco.ts:152` e `pagamento.service.ts:167,194,307,321` — linhas operacionais ainda no prefixo antigo `[correlationId=...]`/`logDe`; têm `pedidoId` e `correlationId` (o contrato permite), mas sem o prefixo `[pagamentos]`, que ajuda no `--no-log-prefix`.
- `CLAUDE.md` (fora do escopo do dev) — atualizar a regra de `requests/` × `http/` e a de ADRs no README × `docs/adr/` (D02/D04), como já sugerido na validação.

## Pendências do usuário (não bloqueiam a revisão)
1. `docker compose down -v && docker compose up -d --build` e `docker compose ps` com todos `(healthy)` (exceto `kafka-ui`).
2. Rodar `http/fluxo-completo.http` de cima para baixo e `requests/observabilidade.http` (MISS/HIT/OFF, preço novo depois do `PUT`, `stop redis` → `degradado`, `stop postgres-pagamentos` → 503 e `unhealthy` em ~30 s, `falhaPercent: 100` → `ABERTO`).
3. `docker compose logs -t --no-log-prefix | grep <X-Request-Id> | sort` mostrando pedidos, catalogo, pagamentos, banco-falso e notificacoes.
4. Teste do clone limpo e, só com pedido explícito, `git tag entrega-final` + `git push --tags`.
