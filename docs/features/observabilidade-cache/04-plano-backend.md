# Plano backend: observabilidade-cache (aula 10, entrega final)
Data: 22/11/2026
Paralelizável com frontend: NÃO (não há frontend; CLAUDE.md "Backend não paraleliza com frontend")
Repositórios afetados: projeto único `usersEcommerceArq` (um `.git`, branch `feat/aula-10-observabilidade-cache`) — pastas: `catalogo/`, `pedidos/`, `pagamentos/`, `notificacoes/`, `usuarios/`, `banco-falso/`, `kong/`, raiz (`docker-compose.yml`, `README.md`, `.env.example`, `requests/`, `http/` nova, `docs/adr/` nova). Perfil: `aulas-ecommerce`.

Contrato: `03-contrato-api.md` (seções citadas como §). Ajustes A01–A09: `02-validacao.md`.

## Banco
Sem modelo Prisma, migration, model Mongoose ou coleção nova. Redis só como cache (chaves em §2.2). `npx prisma validate` e `npx prisma generate` continuam na verificação de usuarios, pedidos e pagamentos.

## Ordem de execução
Catálogo primeiro (maior risco: dependência nova e cache), depois os serviços com Kafka, os sem Kafka, e por fim infra e documentação. Cada serviço é verificado antes de passar ao próximo.

### Passo 0 — Conferência (sem escrita)
- Se houver Docker: `docker run --rm node:22-slim sh -c "which wget curl; node -v"` (só informativo; o healthcheck usa `node -e` de qualquer forma).

### Passo 1 — catalogo
| # | Caminho | Ação | O que fazer |
|---|---|---|---|
| 1.1 | `catalogo/package.json`, `catalogo/package-lock.json` | Alterar | `npm install ioredis@5` dentro de `catalogo/` (atualiza o lock; o Dockerfile usa `npm ci`). |
| 1.2 | `catalogo/src/config/env.ts` | Alterar | `REDIS_URL` e `CACHE_TTL_SEGUNDOS` (§2.6). |
| 1.3 | `catalogo/src/config/redis.ts` | Criar | Cliente ioredis com as opções de §2.5; logs de transição `[catalogo] cache indisponível` / `[catalogo] cache disponível`; `aguardarRedisPronto(ms: number): Promise<boolean>` (resolve `true` no `ready`, `false` no limite, nunca lança; A02); `desconectarRedis(): Promise<void>`. |
| 1.4 | `catalogo/src/utils/log.ts` | Criar | `logEvento`, `descreverErro`, `lerRequestId` (§3.2), prefixo `[catalogo]`. |
| 1.5 | `catalogo/src/utils/health.ts` | Criar | Bloco comum + `healthCatalogoSchema` (§1.4). |
| 1.6 | `catalogo/src/services/cache.service.ts` | Criar | `lerOuBuscar`, `invalidarVitrine`, `redisDisponivel` (§2.3), TTL `env.CACHE_TTL_SEGUNDOS + Math.floor(Math.random() * 10)`, coalescência por chave (recomendado). `invalidarVitrine` falha → `logEvento("falhou", "cache.invalidar", ctx?.pedidoId ?? null, ctx?.correlationId ?? null, { motivo, erro })`; sucesso sem log (ou `console.log` simples sem dado sensível). |
| 1.7 | `catalogo/src/config/kafka.ts` | Alterar | `publicar` → `logEvento("publicou", ...)` substituindo a linha `:80-82`; `iniciarConsumer`: `logEvento("recebeu", ...)` só quando há handler (A09), `descartou` com extração de `pedidoId`/`correlationId` do JSON bruto quando forem strings, `falhou` com `descreverErro(erro)` no lugar do objeto cru (`:132-135`); `kafkaDisponivel(): Promise<boolean>` com admin dedicado `kafka.admin({ retry: { retries: 0 } })`, `connect()` + `describeCluster()` em `comLimite(…, 2000)`, cache de 5 s, promessa compartilhada; em falha, `disconnect()` do admin (ignorando erro) para reconectar na próxima; `desconectarKafka` também desconecta esse admin. |
| 1.8 | `catalogo/src/controllers/health.controller.ts` | Alterar | §1.2/§1.3: `banco` (readyState + `db.admin().ping()`), `kafka` (`kafkaDisponivel`), `cache` (`redisDisponivel`) em `Promise.all`; `Cache-Control: no-store`; 200/503. |
| 1.9 | `catalogo/src/services/produto.service.ts` | Alterar | Novos: `listarVitrineService({ categoria?, busca? }): Promise<ResultadoCache>` (normaliza §2.2, usa `findActiveProdutos` com os valores normalizados, sufixo `produtos:todos` ou `produtos:categoria=..&busca=..`); `listarProdutosPorIdsService(ids: string[]): Promise<IProduto[]>` (sem cache); `getProdutoCacheadoService(idOrSku): Promise<ResultadoCache>` (sufixo `produto:<encodeURIComponent>`, `buscar` = `getProdutoByIdService`, que lança `NotFoundError`). `invalidarVitrine` em create/update/ajustarEstoque/desativar depois do sucesso (§2.4). Manter `getProdutoByIdService` e `listProdutosAtivosService` se usados em outro lugar; código novo sem `any`. |
| 1.10 | `catalogo/src/services/categoria.service.ts` | Alterar | `listCategoriasService(): Promise<ResultadoCache>` via `lerOuBuscar("categorias", findAllCategorias)`; `invalidarVitrine("categoria criada")` depois de `createCategoria`. |
| 1.11 | `catalogo/src/controllers/produto.controller.ts` | Alterar | `GET /`: com `ids` → `listarProdutosPorIdsService` + `res.json` (sem `X-Cache`); sem `ids` → `listarVitrineService` + `res.status(200).set("X-Cache", r.cache).type("application/json").send(r.json)`. `GET /:id` → `getProdutoCacheadoService` com o mesmo envio. Escritas inalteradas. |
| 1.12 | `catalogo/src/controllers/categoria.controller.ts` | Alterar | `GET /` com `X-Cache` (mesmo envio). |
| 1.13 | `catalogo/src/services/reserva.service.ts` | Alterar | `invalidarVitrine(motivo, { pedidoId, correlationId })` nos 3 pontos de §2.4 (reserva: só sucesso, antes do `publicar`). Logs: `:38-40` → `ignorou` (`motivo=evento-repetido`); `:103-105` → `ignorou`; `:112-114` → `processou` (`resultado=reserva-confirmada itens=N`); `:133-135` → `ignorou`; `:146-148` → `compensou` (`acao=estoque-devolvido itens=N`). Sem e-mail no log. |
| 1.14 | `catalogo/src/middleware/requestLog.ts` | Criar | §3.3, prefixo `[catalogo]`. |
| 1.15 | `catalogo/src/middleware/errorHandler.ts` | Alterar | `:59` → linha de §3.4 (Antes: `console.error("Erro interno não tratado no catalogo:", err)` / Depois: `console.error(\`[catalogo] erro 500 ${req.method} ${req.path} correlationId=${lerRequestId(req.header("x-request-id")) ?? "-"} erro=${descreverErro(err)}\`)`). Não reescrever o resto (legado `err: any`). |
| 1.16 | `catalogo/src/index.ts` | Alterar | `app.use(requestLog)` antes de `express.json()`; em `startServer`, depois de `connectDatabase()`: `if (await aguardarRedisPronto(2000)) await invalidarVitrine("subida do catálogo")` (senão log de aviso); `encerrar()` chama `desconectarRedis()`. Redis nunca impede a subida. |

Verificação: `cd catalogo && npx tsc --noEmit && npm run build`.

### Passo 2 — pedidos
| # | Caminho | Ação | O que fazer |
|---|---|---|---|
| 2.1 | `pedidos/src/utils/log.ts` | Criar | §3.2, prefixo `[pedidos]`. |
| 2.2 | `pedidos/src/utils/health.ts` | Criar | Comum + `healthPedidosSchema`. |
| 2.3 | `pedidos/src/config/kafka.ts` | Alterar | Igual ao 1.7 (`publicou`, `recebeu`, `descartou`, `falhou`, `kafkaDisponivel`). |
| 2.4 | `pedidos/src/controllers/health.controller.ts` | Alterar | `banco` (`SELECT 1` com limite) + `kafka`; **sem** catálogo (RN01). |
| 2.5 | `pedidos/src/services/pedido.service.ts` | Alterar | `:113-116` e `:276-279` → `falhou` com `descreverErro`; `:134-141`, `:158-165`, `:181-186`, `:203-210` → `ignorou` / `processou status=<novo>` / `compensou acao=pedido-cancelado` (remove o "recebido" duplicado; o `recebeu` agora é do `kafka.ts`). |
| 2.6 | `pedidos/src/consumers/estoque.consumer.ts`, `pedidos/src/consumers/pagamentos.consumer.ts` | Alterar | Os `console.error` de dados inválidos passam a `logEvento("descartou", ...)` com `pedidoId`/`correlationId` do envelope; sem `dados` crus no log. |
| 2.7 | `pedidos/src/controllers/pedido.controller.ts`, `pedidos/src/controllers/carrinho.controller.ts` | Alterar | `req.header("x-request-id")` → `lerRequestId(req.header("x-request-id"))` (A05). |
| 2.8 | `pedidos/src/middleware/requestLog.ts` | Criar | §3.3 (obrigatório: é onde a compra entra). |
| 2.9 | `pedidos/src/middleware/errorHandler.ts` | Alterar | `:48-51` → §3.4. |
| 2.10 | `pedidos/src/index.ts` | Alterar | `app.use(requestLog)` antes de `express.json()`. |

Verificação: `cd pedidos && npx prisma validate && npx prisma generate && npx tsc --noEmit && npm run build`.

### Passo 3 — pagamentos
| # | Caminho | Ação | O que fazer |
|---|---|---|---|
| 3.1 | `pagamentos/src/utils/log.ts` | Criar | §3.2, prefixo `[pagamentos]`. |
| 3.2 | `pagamentos/src/utils/health.ts` | Criar | Comum + `healthPagamentosSchema` + `EstadoCircuito`. |
| 3.3 | `pagamentos/src/banco.ts` | Alterar | `estadoCircuito(): EstadoCircuito` com `"ABERTO" \| "MEIO-ABERTO" \| "FECHADO"` (D05); `:181` → `descreverErro(erro)`. |
| 3.4 | `pagamentos/src/config/kafka.ts` | Alterar | Igual ao 1.7. |
| 3.5 | `pagamentos/src/controllers/health.controller.ts` | Alterar | `banco` + `kafka` + `circuitoBancoCartao`; degradado se `ABERTO`/`MEIO-ABERTO` (§1.3). |
| 3.6 | `pagamentos/src/services/pagamento.service.ts` | Alterar | `:123` e `:209` → `compensou acao=estornado`; `:213` → `falhou` com `descreverErro`; `:250` (resultado final) → `processou resultado=<APROVADO\|RECUSADO>`; linhas de "ignorado" → `ignorou`. Demais linhas podem ficar. |
| 3.7 | `pagamentos/src/consumers/eventos.consumer.ts` | Alterar | `:18` → `descartou` (como 2.6). |
| 3.8 | `pagamentos/src/middleware/requestLog.ts` | Criar | §3.3. |
| 3.9 | `pagamentos/src/middleware/errorHandler.ts` | Alterar | `:48` → §3.4. |
| 3.10 | `pagamentos/src/index.ts` | Alterar | `app.use(requestLog)` antes de `express.json()`. |

Verificação: `cd pagamentos && npx prisma validate && npx prisma generate && npx tsc --noEmit && npm run build`.

### Passo 4 — notificacoes
| # | Caminho | Ação | O que fazer |
|---|---|---|---|
| 4.1 | `notificacoes/src/config/env.ts` | Alterar | `PORT` (padrão 3000). |
| 4.2 | `notificacoes/src/utils/log.ts` | Criar | §3.2, prefixo `[notificacoes]`; `descreverErro` sem `message` (A03). |
| 4.3 | `notificacoes/src/utils/health.ts` | Criar | Comum (só tipos TS, sem zod) + `HealthNotificacoes`. |
| 4.4 | `notificacoes/src/config/kafka.ts` | Alterar | `recebeu` (só com handler), `descartou`, `falhou` com `descreverErro`; `kafkaDisponivel` (admin dedicado, como 1.7). |
| 4.5 | `notificacoes/src/config/smtp.ts` | Alterar | `smtpDisponivel(): Promise<boolean>` com `smtp.verify()` em `comLimite(…, 2000)`, cache 5 s, promessa compartilhada. |
| 4.6 | `notificacoes/src/health.ts` | Criar | Servidor `node:http`: `GET /health` → §1.5 com `Cache-Control: no-store`; outro caminho/método → 404 `{"erro":"Rota não encontrada."}`; exporta `iniciarServidorHealth(porta): Server`. Sem log de requisição. |
| 4.7 | `notificacoes/src/services/notificacao.service.ts` | Alterar | `:22-24` → `processou <tipo> ... resultado=email-enviado` (sem destinatário nem assunto com dado pessoal). |
| 4.8 | `notificacoes/src/consumers/eventos.consumer.ts` | Alterar | `:25`, `:36`, `:52` → `descartou`/`falhou` sem dados crus. |
| 4.9 | `notificacoes/src/index.ts` | Alterar | Depois do consumer: `const server = iniciarServidorHealth(env.PORT)`; `encerrar()` fecha o server; comentário "sem Express, sem rota de negócio; HTTP só para /health". |
| 4.10 | `notificacoes/Dockerfile` | Alterar | `ENV PORT=3000`, `EXPOSE 3000` e comentário `:29` ("Sem EXPOSE: o serviço não tem HTTP") atualizado. |

Verificação: `cd notificacoes && npx tsc --noEmit && npm run build`.

### Passo 5 — usuarios
| # | Caminho | Ação | O que fazer |
|---|---|---|---|
| 5.1 | `usuarios/src/utils/log.ts` | Criar | `descreverErro`, `lerRequestId`. |
| 5.2 | `usuarios/src/utils/health.ts` | Criar | Comum + `healthUsuariosSchema`. |
| 5.3 | `usuarios/src/controllers/health.controller.ts` | Alterar | `banco` com limite; 200/503 (§1.5). |
| 5.4 | `usuarios/src/middleware/requestLog.ts` | Criar | §3.3 (`POST /auth/login` sem corpo). |
| 5.5 | `usuarios/src/middleware/errorHandler.ts` | Alterar | `:50` → §3.4 (A04: Prisma só `name code`). |
| 5.6 | `usuarios/src/index.ts` | Alterar | `app.use(requestLog)` antes de `express.json()`. |
| 5.7 | `usuarios/prisma/seed.ts` | Alterar | `:28,30,62,64` → logar o perfil, não o e-mail (seed continua idempotente; nada mais muda). |

Verificação: `cd usuarios && npx prisma validate && npx prisma generate && npx tsc --noEmit && npm run build`.

### Passo 6 — banco-falso
| # | Caminho | Ação | O que fazer |
|---|---|---|---|
| 6.1 | `banco-falso/src/utils/log.ts` | Criar | `descreverErro`, `lerRequestId`. |
| 6.2 | `banco-falso/src/controllers/banco.controller.ts` | Alterar | `GET /health` → `{ servico: "banco-falso", status: "ok", dependencias: {} }` + `Cache-Control: no-store` (§1.5). Opcional: passar `lerRequestId(req.header("x-request-id"))` ao service para incluir `correlationId=` nas linhas `[Banco]`. |
| 6.3 | `banco-falso/src/middleware/requestLog.ts` | Criar | §3.3, prefixo `[banco-falso]` (põe o banco no grep da compra). |
| 6.4 | `banco-falso/src/middleware/errorHandler.ts` | Alterar | `:21-24` → §3.4. |
| 6.5 | `banco-falso/src/index.ts` | Alterar | `app.use(requestLog)` antes de `express.json()`. |

Verificação: `cd banco-falso && npx tsc --noEmit && npm run build`.

### Passo 7 — kong
| # | Caminho | Ação | O que fazer |
|---|---|---|---|
| 7.1 | `kong/kong.yml` | Alterar | Serviço `notificacoes-health` (§5) depois do bloco de pagamentos. Opcional: nada mais. |

### Passo 8 — docker-compose
| # | Caminho | Ação | O que fazer |
|---|---|---|---|
| 8.1 | `docker-compose.yml` | Alterar | Serviço `redis` (§4.4); healthcheck nos 6 serviços de aplicação (§4.1) e em gateway, mongo-catalogo, redis, mailpit (§4.2); `depends_on` de §4.3 (gateway passa a mapa com `service_healthy` e inclui notificacoes; pedidos perde catalogo; banco-falso e mailpit viram `service_healthy`); env novas (§4.5); comentários do topo e de notificacoes ("sem porta" continua verdadeiro: não publica; "sem rota no Kong" → "só /health no Kong"). |

Verificação: `docker compose config --quiet` na raiz.

### Passo 9 — arquivos `.http`
| # | Caminho | Ação | O que fazer |
|---|---|---|---|
| 9.1 | `http/fluxo-completo.http` | Criar | §6.1. |
| 9.2 | `requests/observabilidade.http` | Criar | §6.2. |
| 9.3 | `requests/demos.http` | Alterar | `:26` e comentários: `circuitoBancoCartao: FECHADO/ABERTO/MEIO-ABERTO`. |
| 9.4 | `requests/pagamentos.http` | Alterar | `:15` idem. |
| 9.5 | `requests/usuarios.http`, `requests/catalogo.http`, `requests/pedidos.http` | Alterar | Comentários dos health com o corpo novo `{ servico, status, dependencias }`; `catalogo.http` ganha nota sobre `X-Cache`. |

### Passo 10 — documentação
| # | Caminho | Ação | O que fazer |
|---|---|---|---|
| 10.1 | `docs/adr/0001-*.md` … `docs/adr/0009-*.md` | Criar | Migrar ADRs 001–009 de `README.md:288-322`, um por arquivo, com Contexto, Decisão, Consequências (D04). |
| 10.2 | `docs/adr/0010-health-tres-estados-e-logs-correlacionados.md` | Criar | Health ok/degradado/fora do ar; não chama outros serviços; essenciais × não essenciais; logs `[servico] verbo tipo pedidoId correlationId`; `/health` fora do log; sem dado sensível. |
| 10.3 | `docs/adr/0011-cache-redis-cache-aside-com-versao.md` | Criar | Cache-aside, `catalogo:versao`, TTL 60 s com variação, o que nunca cachear (`?ids=`, carrinho, pedido, pagamento, `GET /pedidos/:id`), Redis sem persistência e `volatile-lru`, `OFF`. |
| 10.4 | `docs/adr/0012-subida-do-zero-com-um-comando.md` | Criar | Padrões no compose, healthchecks, `service_healthy`, gateway por último, migrações/seeds/tópicos idempotentes. |
| 10.5 | `README.md` | Alterar | Seção ADR vira índice com links; "Como executar" com `docker compose down -v && docker compose up -d --build` (opcional `--wait`); portas; usuários do seed; diagrama Mermaid com os 15 containers (D14); tabela de serviços; tabela de eventos; rotas (`/health/notificacoes`, corpo novo dos health, `X-Cache`); seção "Demonstração" (saga, recusa, cancelamento, circuit breaker, health, cache, grep do log); limitações (D16); `circuitoBancoExterno` → `circuitoBancoCartao` (`:153`, `:207`). |
| 10.6 | `.env.example` | Alterar | Comentário: `.env` é opcional; todas as variáveis têm padrão no compose. |

### Passo 11 — verificação final
`npx tsc --noEmit` e `npm run build` em catalogo, pedidos, pagamentos, notificacoes, usuarios, banco-falso; `npx prisma validate` e `npx prisma generate` em usuarios, pedidos, pagamentos; `docker compose config --quiet` na raiz; `grep -rn "circuitoBancoExterno" --include=*.ts --include=*.http --include=*.md . ` sem ocorrência fora de `aulas/` e `docs/features/`.
Pendências do usuário: `docker compose down -v && docker compose up -d --build`, `docker compose ps` todos `(healthy)`, rodar `http/fluxo-completo.http` e `requests/observabilidade.http`, teste do clone limpo, tag `entrega-final` (só com pedido explícito).

## Queries previstas
| Função | Modelo / recurso | Operação | Retorno | Transação/lock |
|---|---|---|---|---|
| health `banco` (usuarios, pedidos, pagamentos) | Postgres | `SELECT 1` | — | não |
| health `banco` (catalogo) | Mongo | `admin().ping()` | — | não |
| health `kafka` | Kafka admin | `describeCluster()` | — | não; cache 5 s |
| health `cache` | Redis | `PING` | — | não |
| `lerOuBuscar` | Redis | `GET catalogo:versao`, `GET <chave>`, `SET <chave> <json> EX <ttl>` | string JSON | não (versão lida antes do Mongo) |
| `invalidarVitrine` | Redis | `INCR catalogo:versao` | inteiro | não; depois da escrita no Mongo |
| `listarVitrineService` | `Produto` | `find({ ativo: true, categoria?, nome?: regex i }).sort({ criado_em: -1 })` (inalterada) | documento completo (contrato atual) | não |
| `getProdutoCacheadoService` | `Produto` | `findById` / `findOne({ sku })` (inalterada) | documento completo | não |
| `listCategoriasService` | `Categoria` | `findAllCategorias` (inalterada) | lista | não |

## Concorrência e efeitos colaterais
- Leitura: versão lida antes do Mongo; uma resposta montada com dado velho fica na chave da versão antiga, que ninguém mais lê depois do `INCR`.
- Escrita: `INCR` só depois do sucesso no Mongo; erro do Redis logado e engolido (o consumer nunca relança por cache, senão o Kafka reentregaria e a idempotência da reserva seria testada à toa).
- Reserva concorrente continua decidida no Mongo (`$gte` em `reservarEstoque`); o cache não participa do checkout (`?ids=` sem cache).
- Redis perdido (reinício): versão e chaves somem juntas (sem persistência); nada velho volta. Redis inalcançável sem reiniciar durante uma escrita: dado velho por até TTL (60–69 s) — limitação documentada (D16).
- `catalogo:versao` protegida de despejo por `volatile-lru` (A01).
- Health: checagens em paralelo, com limite de 2 s; Kafka e SMTP com resultado de 5 s e promessa compartilhada (sem empilhar conexões se o Docker e o Kong chamarem juntos).
- Subida: `up -d` só retorna depois de os 5 serviços que o gateway espera ficarem healthy (o gateway sobe por último).

## Integração entre serviços
1. Nenhuma mudança de contrato entre serviços (eventos, envelope, `?ids=` e `x-request-id` inalterados). Os serviços podem ser alterados em qualquer ordem; a ordem acima só reduz risco.
2. `pedidos` deixa de depender (no compose) do `catalogo`; em tempo de execução, catálogo fora continua 503 no checkout.
3. Desligado/removido: chave `circuitoBancoExterno` e valores minúsculos; campos `database`/`banco: "conectado"` e `latenciaMs`/`falhaPercent` dos health antigos; linha "recebido ..." duplicada do pedidos; impressão de objetos de erro crus.

## Dependências novas
| Pacote | Versão | Serviço | Motivo |
|---|---|---|---|
| `ioredis` | `^5` (resolvida pelo `npm install ioredis@5`) | catalogo | cliente Redis com `set(k, v, "EX", ttl)` do slide; tipos próprios |

## Variáveis de ambiente novas
| Nome | Validação | Exemplo | Serviço |
|---|---|---|---|
| `REDIS_URL` | string; padrão `redis://redis:6379` | `redis://redis:6379` | catalogo |
| `CACHE_TTL_SEGUNDOS` | inteiro ≥ 1; padrão 60 | `60` | catalogo |
| `PORT` | inteiro; padrão 3000 | `3000` | notificacoes |

## Critérios de aceite
- [ ] RF01: `GET /health` dos 6 serviços responde no formato de §1.4, com 200/503 conforme §1.3, em < 2,5 s mesmo com dependência parada; nenhum health chama outro serviço.
- [ ] RF02: `GET /health/notificacoes` pelo Kong, sem token, 200; demais `/health/<servico>` com o corpo novo.
- [ ] RF03: `docker compose config --quiet` sem erro; healthchecks e `depends_on` exatamente como §4; `docker compose ps` todos `(healthy)` (pendência do usuário).
- [ ] RF04: linhas `publicou`/`recebeu`/`processou`/`compensou`/`ignorou`/`descartou`/`falhou` no formato §3.1 em pedidos, catalogo, pagamentos, notificacoes; log HTTP §3.3 sem `/health`; erro 500 §3.4; nenhum `console.*(…, erro)` com objeto cru nos arquivos tocados.
- [ ] RF05: grep pelo `X-Request-Id` do checkout mostra pedidos, catalogo, pagamentos, notificacoes e banco-falso.
- [ ] RF06: `GET /produtos` `MISS` → `HIT`; `GET /produtos/:id` e `GET /categorias` idem; `?ids=` sem `X-Cache`; 404 sem `X-Cache` e não cacheado.
- [ ] RF07: depois de `PUT /produtos/:id`, de compra, de recusa e de cancelamento, o GET seguinte é `MISS` com o dado novo; falha do Redis na invalidação não interrompe o consumer.
- [ ] RF07/RN07: com `redis` parado, vitrine 200 `X-Cache: OFF` sem atraso perceptível (≤ ~200 ms a mais), `/health/catalogo` `degradado` 200; ao voltar, `HIT/MISS` sem reiniciar o catálogo.
- [ ] RF08: `redis` com `--save ""`, `--appendonly no`, `volatile-lru`, sem `ports`.
- [ ] RF09: `http/fluxo-completo.http` sem valor fixo, cobrindo §6.1; `requests/observabilidade.http` cobrindo §6.2.
- [ ] RF10: `docs/adr/` com 12 ADRs (Contexto, Decisão, Consequências); README com índice, diagrama dos 15 containers, demonstração e limitações.
- [ ] RN04: nenhum log com senha, token, cartão completo, CPF ou e-mail (inclusive seed e SMTP).
- [ ] RN09: seeds e tópicos continuam idempotentes (seed do catálogo inalterado; seed de usuarios só muda o texto do log).
- [ ] `npx tsc --noEmit` e `npm run build` em todos os serviços alterados; `npx prisma validate/generate` em usuarios, pedidos, pagamentos; código novo sem `any`.
