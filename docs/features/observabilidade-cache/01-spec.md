# Spec: Observabilidade, cache e fechamento do sistema (aula 10, entrega final)
Status: PRONTA
Data: 22/11/2026

Fonte da verdade: `aulas/texto/10-observabilidade-e-cache.txt` (PDF "10 - Arq. Sis. - Observabilidade e Cache"). O .txt não traz numeração de slides; as citações usam o título do slide (ex.: slide "O QUE ENTREGAR 1/3"). Branch: `feat/aula-10-observabilidade-cache`. Entrega: tag `entrega-final` (slide "ENTREGA FINAL": sem o compose subindo tudo e o .http vendendo, o trabalho é invalidado).

Perfil do projeto: `aulas-ecommerce` (CLAUDE.md da raiz; substitui `api-express`). Projeto único (um `.git`), sem frontend.

## Objetivo
Última entrega: nenhum serviço novo. Deixar o sistema existente observável (`/health` com 3 estados, healthcheck no Docker, logs correlacionados por `pedidoId` e `correlationId`), mais rápido na vitrine (cache Redis com invalidação por versão) e pronto para alguém de fora subir e entender (README, ADRs, diagrama, `fluxo-completo.http`, subida do zero com um comando).

## Regras de negócio
- RN01 — `/health` diz se o PRÓPRIO serviço consegue trabalhar. Nunca chama o `/health` de outro serviço (slide "RESPOSTAS 1 E 2", pergunta 1: evita falha em cascata). A dependência do catálogo aparece no 503 do checkout e no health do catálogo.
- RN02 — Estados: `ok` (200), `degradado` (200: funciona pior, ex.: sem cache, circuito aberto), `fora do ar` (503: sem dependência essencial). Essenciais: banco do serviço e Kafka. Cache, circuito do banco do cartão e SMTP nunca derrubam o serviço (slide "HEALTH CHECK: ESTÁ TUDO BEM?" e "VIVO × PRONTO").
- RN03 — O health testa de verdade (`SELECT 1`, ping do Mongo, chamada ao admin do Kafka, `PING` no Redis) e é barato (chamado a cada 10 s): sem consulta pesada.
- RN04 — Toda linha de log de evento (publicou, recebeu, compensou, ignorou, descartou) leva `pedidoId` e `correlationId`. Nunca senha, token JWT, número de cartão, CPF ou e-mail completo de cliente (slide "LOGS: O QUE ESCREVER"). `/health` fora do log.
- RN05 — O `correlationId` nasce no Kong (`X-Request-Id`), entra no pedidos pelo cabeçalho, vai para o envelope do evento e cada consumer o copia para o evento seguinte (slide "UMA COMPRA, CINCO SERVIÇOS, UM ID").
- RN06 — Cache só para o que muitos leem e muda pouco: vitrine (`GET /produtos` com filtros), detalhe (`GET /produtos/:id`) e `GET /categorias`. NUNCA: estoque exato no checkout, carrinho, pedido, pagamento (slide "O QUE CACHEAR (E O QUE NUNCA)"). Consequência: `GET /produtos?ids=` (usado por `pedidos/src/catalogo.ts:35` no checkout e no carrinho) NÃO passa pelo cache.
- RN07 — Cache acelera, não sustenta: Redis fora → a vitrine responde direto do Mongo (`X-Cache: OFF`) e o health do catálogo fica `degradado` (200), nunca 503.
- RN08 — Invalidação por versão (`INCR catalogo:versao`) em toda escrita de produto/categoria e sempre que o estoque muda (reserva, confirmação, devolução pelos consumers, `PATCH /produtos/:id/estoque`). O TTL (60 s) é a rede de segurança se a invalidação falhar (slide "RESPOSTAS 3 E 4", pergunta 3).
- RN09 — O sistema sobe do zero com `docker compose down -v && docker compose up -d --build`, sem `.env` fora do git e sem passo manual: migrações, seeds e tópicos automáticos e idempotentes.

## Requisitos funcionais
- RF01 — `GET /health` em usuarios, catalogo, pedidos, pagamentos, notificacoes e banco-falso, formato `{ servico, status, dependencias }` (atende RN01–RN03). Tabela na seção "Contrato do /health".
- RF02 — Pelo Kong, `GET /health/<servico>` público (sem token) para usuarios, catalogo, pedidos, pagamentos e notificacoes (ver Decisão D03). banco-falso fica fora do Kong (porta 9000) (atende RN02).
- RF03 — `healthcheck` no compose para TODOS os serviços de aplicação (usuarios, catalogo, pedidos, pagamentos, notificacoes, banco-falso) e para gateway, mongo, redis, mailpit: `interval 10s`, `timeout 3s`, `retries 3`, `start_period`. `depends_on` com `condition: service_healthy` onde fizer sentido (atende RN09).
- RF04 — Logs: acrescentar linha "recebeu" padronizada nos consumers, log de requisição HTTP (sem `/health`) no pedidos e demais serviços HTTP, `x-request-id` nos logs de erro 500 e no banco-falso; corrigir logs que despejam o objeto de erro cru (atende RN04, RN05).
- RF05 — `docker compose logs | grep <X-Request-Id>` mostra a compra em pelo menos 4 serviços (pedidos, catalogo, pagamentos, notificacoes; mais banco-falso e Kong se RF04 opcional for feito) (atende RN05).
- RF06 — Cache Redis (cache-aside, TTL 60 s, chave com versão) em `GET /produtos` (com `categoria` e `busca`), `GET /produtos/:id` e `GET /categorias`; header `X-Cache: HIT|MISS|OFF` (atende RN06, RN07).
- RF07 — Invalidação por `INCR catalogo:versao` em: `POST/PUT/DELETE /produtos`, `PATCH /produtos/:id/estoque`, `POST /categorias`, e nos consumers do catálogo quando o estoque muda (reserva, confirmação, devolução). Falha de Redis na invalidação é logada e engolida (não relança para o Kafka) (atende RN08).
- RF08 — Redis no compose sem persistência: `--save ""` e `--appendonly no`, sem volume, sem porta publicada (slide "AS ARMADILHAS DO CACHE").
- RF09 — `http/fluxo-completo.http` (ver Decisão D02): login → vitrine → carrinho → checkout 202 → pedido até PAGO → pagamento; depois cartão 0002 (CANCELADO, estoque de volta), cancelamento com estorno, cliente em rota de admin (403). Sem valor fixo: token e ids por `# @name` (atende RN09).
- RF10 — README completo (subir com um comando, portas, usuários do seed, diagrama que bate com o compose, tabela de serviços, tabela de eventos, rotas e acesso, demonstração de saga/recusa/cancelamento/circuit breaker/health/cache, limitações) e `docs/adr/` com pelo menos 3 ADRs, um arquivo cada, com contexto, decisão e consequências.
- RF11 — Tag `entrega-final` após o teste do clone limpo (slide "ANTES DE ENTREGAR: O TESTE DO CLONE LIMPO"). Criar a tag e `git push --tags` só com pedido explícito do usuário.

## Projetos envolvidos
| Projeto (pasta) | Perfil | Papel na feature | Versões relevantes |
|---|---|---|---|
| `usuarios/` | aulas-ecommerce (Express + Prisma + PostgreSQL) | health 3 estados, request log, log de erro com x-request-id | Express 4, Prisma 6, Zod 3, Node 22 |
| `catalogo/` | aulas-ecommerce (Express + Mongoose + MongoDB) | health com Mongo/Kafka/Redis, cache Redis, invalidação nos consumers, "recebeu" | Express 4, Mongoose 8, kafkajs 2.2, ioredis 5 (novo) |
| `pedidos/` | aulas-ecommerce (Express + Prisma + PostgreSQL) | health banco/Kafka, request log com x-request-id, "recebeu" | Express 4, Prisma 6, kafkajs 2.2 |
| `pagamentos/` | aulas-ecommerce (Express + Prisma + PostgreSQL) | health banco/Kafka/circuito, "recebeu" | Express 4, Prisma 6, opossum |
| `notificacoes/` | aulas-ecommerce (só consumer, sem Express) | HTTP mínimo só para `/health` (node:http, sem dependência nova), "recebeu" | kafkajs 2.2, nodemailer |
| `banco-falso/` | aulas-ecommerce (Express sem banco) | health no formato novo, x-request-id nos logs | Express 4 |
| `kong/` | declarativo | rota `/health/notificacoes`, log de acesso com X-Request-Id (opcional) | Kong 3.9 |
| raiz | compose, README, docs/adr, http/ | Redis, healthchecks, depends_on, diagrama, ADRs, fluxo-completo | Docker Compose |

## Requisitos não funcionais
- Banco(s) alvo: PostgreSQL 16 (usuarios, pedidos, pagamentos, bancos separados), MongoDB 7 (catalogo), Redis (cache, sem persistência). Tabelas compartilhadas entre projetos: nenhuma (um banco por serviço; sem FK entre bancos). Esta entrega NÃO cria tabela, coleção nem migration.
- Segurança: `/health` e `/health/<servico>` são públicos (só estado, sem versão, host, stack ou mensagem do banco). Redis sem porta publicada. Logs sem dado sensível (RN04). Nenhuma porta nova publicada (aula: só Kong 8080/8001/8002, Kafka UI, Mailpit 8025 e banco-falso 9000).
- Performance: health responde em < 3 s (timeout do Docker); cada verificação de dependência limitada a ~2 s e executadas em paralelo; verificação do Kafka com resultado reaproveitado por alguns segundos. Vitrine: referência da aula MISS 0,51 s, HIT 0,008 s.
- Concorrência: leitura da versão ANTES da consulta ao Mongo (a resposta lida sob a versão antiga fica numa chave que ninguém mais lê depois do `INCR`). Invalidar DEPOIS da escrita bem-sucedida. Avalanche (stampede): TTL com variação e coalescência de buscas simultâneas na mesma chave são recomendados, não obrigatórios.
- Fuso: instantes em UTC (`ocorridoEm` já em ISO UTC); sem data de negócio nova.
- Execução: processos únicos por serviço, `restart: unless-stopped`. Redis em memória, sem volume. Docker só marca `unhealthy`, não reinicia (quem age é um orquestrador).

## Contrato do /health
Resposta: `{ "servico": "<pasta>", "status": "ok|degradado|fora do ar", "dependencias": { ... } }`. HTTP 200 para `ok` e `degradado`, 503 para `fora do ar`. Valores de dependência: `"ok"` | `"fora"`; circuito: `"FECHADO"` | `"ABERTO"` | `"MEIO-ABERTO"`.

| Serviço | Dependências no JSON | Essenciais (503 se fora) | Degradado quando |
|---|---|---|---|
| usuarios | `banco` | banco (`SELECT 1`) | nunca |
| catalogo | `banco` (ping do Mongo), `kafka`, `cache` (PING) | banco, kafka | `cache` fora |
| pedidos | `banco`, `kafka` | banco, kafka | nunca (não consulta o catálogo, RN01) |
| pagamentos | `banco`, `kafka`, `circuitoBancoCartao` | banco, kafka | circuito `ABERTO` ou `MEIO-ABERTO` |
| notificacoes | `kafka`, `smtp` | kafka | `smtp` fora |
| banco-falso | `{}` (sem dependência) | nenhuma | nunca |

Exemplo (slide "HEALTH CHECK"): pagamentos com circuito aberto → 200 `{ "servico": "pagamentos", "status": "degradado", "dependencias": { "banco": "ok", "kafka": "ok", "circuitoBancoCartao": "ABERTO" } }`. Banco de pagamentos parado → 503 `fora do ar`; pronto quando `docker compose ps` mostrar `(unhealthy)` em ~30 s (3 falhas de 10 s).

## Entidades
Sem entidade de banco nova. Chaves do Redis (catálogo):

| Chave | Valor | TTL | Observação |
|---|---|---|---|
| `catalogo:versao` | inteiro (`INCR`; ausente = 0) | sem TTL (um único contador; perde-se junto com o Redis, que não persiste) | única chave sem TTL, justificada |
| `catalogo:v<N>:produtos:categoria=<c>&busca=<b>` | JSON exato do corpo da resposta de `GET /produtos` | 60 s (+ variação) | `categoria` em minúsculas (o repositório já faz `toLowerCase`, `produto.repository.ts:16`); `busca` normalizada (trim, minúsculas, codificada); sem filtro = `todos` |
| `catalogo:v<N>:produto:<idOuSku>` | JSON do produto | 60 s (+ variação) | só respostas 200; 404 não é cacheado |
| `catalogo:v<N>:categorias` | JSON da lista | 60 s (+ variação) | |

Variáveis de ambiente novas (catálogo, em `catalogo/src/config/env.ts`, com padrão): `REDIS_URL` (padrão `redis://redis:6379`), `CACHE_TTL_SEGUNDOS` (padrão 60). No compose, ambas com valor padrão.

## Fluxos do usuário
1. Subir: `docker compose down -v && docker compose up -d --build`. O gateway é o último a ficar pronto (depende de todos `service_healthy`); quando o comando retorna, `docker compose ps` mostra tudo `(healthy)`.
2. Abrir `http/fluxo-completo.http` e rodar de cima para baixo, sem editar: login do cliente do seed → vitrine (guarda o id) → carrinho → checkout (202) → reenviar o GET do pedido até `PAGO` → GET do pagamento (`APROVADO`) → cartão final 0002 (pedido `CANCELADO` com motivo, estoque de volta) → cancelamento com estorno (banco lento; pagamento `ESTORNADO` ou `CANCELADO`, estoque de volta) → cliente em rota de admin (403).
3. Acompanhar uma compra: `docker compose logs -t --no-log-prefix | grep <X-Request-Id da resposta do checkout> | sort` mostra pedidos, catalogo, pagamentos, notificacoes.
4. Saúde: `GET /health/<servico>` pelo Kong. Parar `postgres-pagamentos` → 503 e `unhealthy` em ~30 s. `POST localhost:9000/config {"falhaPercent":100}` + compras → circuito `ABERTO` e `degradado` 200.
5. Cache: `GET /produtos` → `X-Cache: MISS`, de novo → `HIT`; admin muda o preço → o GET seguinte já traz o preço novo (`MISS`); `docker compose stop redis` → `X-Cache: OFF`, vitrine responde, `/health/catalogo` `degradado` 200; `docker compose start redis` volta ao normal.

## Código existente reaproveitável
| Caminho | O que reaproveitar |
|---|---|
| `pedidos/src/config/kafka.ts:34-52` (idem catalogo, pagamentos, notificacoes) | `garantirTopicos()` já cria tópicos idempotente e usa `kafka.admin()`; base do teste de saúde do Kafka |
| `pagamentos/src/banco.ts:138-142` | `estadoCircuito()` (hoje devolve minúsculas `fechado/aberto/meio-aberto`; o health passa a exibir maiúsculas, D05) |
| `pagamentos/src/controllers/health.controller.ts:9-17` | já checa `SELECT 1` e circuito; falta Kafka, status de 3 estados e formato |
| `catalogo/src/config/db.ts`, `pedidos/src/config/db.ts`, `usuarios/src/config/db.ts`, `pagamentos/src/config/db.ts` | clientes de banco para o health |
| `banco-falso/src/controllers/banco.controller.ts:51-53` | `/health` já existe (200 `{status:"ok", latenciaMs, falhaPercent}`) |
| `pedidos/src/middleware/errorHandler.ts:47-50` e `pagamentos/src/middleware/errorHandler.ts:47-50`, `banco-falso/src/middleware/errorHandler.ts:21-24` | padrão de log de erro 500 com `x-request-id` (replicar em usuarios e catalogo) |
| `*/src/config/kafka.ts:80-83` | linha "publicado tipo pedidoId correlationId" já presente nos 3 produtores |
| `kong/kong.yml:55-62, 81-88, 100-107, 128-135` | modelo das rotas `/health/<servico>` (strip_path true); `kong.yml:159-163` correlation-id |
| `requests/fluxo-compra.http` | cenários A/B/C/D da saga; base do `fluxo-completo.http` |
| `README.md:288-322` | ADRs 001–009 (texto a migrar para `docs/adr/`) |

## Levantamento do que existe hoje (mapa e lacunas)

### Itens da entrega (slide "O QUE ENTREGAR" 1/3, 2/3, 3/3)
| # | Item | Estado atual | Lacuna |
|---|---|---|---|
| 1 | `/health` em todos | existe em usuarios (`usuarios/src/controllers/health.controller.ts:6-19`), catalogo (`catalogo/src/controllers/health.controller.ts:6-20`), pedidos (`pedidos/src/controllers/health.controller.ts:7-20`), pagamentos (`pagamentos/src/controllers/health.controller.ts:9-17`), banco-falso (`banco-falso/src/controllers/banco.controller.ts:51-53`) | formato errado (`{status, database}`/`{status, banco}`), 500 em vez de 503, sem 3 estados, sem Kafka/Redis, catálogo só olha `readyState`; notificacoes não tem HTTP (`notificacoes/src/index.ts:1-25`, Dockerfile sem EXPOSE `:29`) |
| 2 | healthcheck no compose | só postgres (`docker-compose.yml:51-55, 118-122, 244-248`) e kafka (`:175-180`) | nenhum serviço de aplicação, gateway, mongo, mailpit, banco-falso; `depends_on` sem `service_healthy` em mongo (`:100-101`), catalogo→pedidos (`:143-144`), banco-falso (`:272-273`), mailpit (`:228-229`), gateway (`:32-36`) |
| 3 | logs | linhas de evento já têm `[correlationId=...]` e `pedidoId=` (`*/src/config/kafka.ts:80-83`, `pedidos/src/services/pedido.service.ts:134-141`, `catalogo/src/services/reserva.service.ts:38-147`, `pagamentos/src/services/pagamento.service.ts:119-316`, `notificacoes/src/services/notificacao.service.ts:22-24`) | ver "Lacunas de log" abaixo |
| 4 | README / ADR / diagrama | README existe (ADRs 001–009 dentro dele, `README.md:288-322`) | `docs/adr/` inexistente; sem seção "Demonstração"; diagrama (`README.md:14-36`) não mostra Redis, Kafka UI, Mailpit, bancos de cada serviço nem bate com os 15 containers; `README.md:89-90` diz `docker compose up --build` (sem `-d`) |
| 5 | fluxo completo | `requests/fluxo-compra.http` (saga A–D), `requests/demos.http` | `http/fluxo-completo.http` inexistente; não cobre vitrine (usa `?ids=CEL-001`, `fluxo-compra.http:48`) nem o 403 de cliente em rota admin |
| 6 | sobe do zero | migrações (`usuarios/Dockerfile:43`, `pedidos/Dockerfile:43`, `pagamentos/Dockerfile:43`), seed usuarios (`prisma/seed.ts`) e catalogo (`catalogo/Dockerfile:38`), tópicos (`garantirTopicos`) automáticos e idempotentes; `JWT_SECRET` com padrão no compose (`docker-compose.yml:31, 70`; `${JWT_SECRET:-supersecret_ecommerce_jwt_key_2026}`) | OK quanto ao `.env`: nenhuma variável do compose é obrigatória; `.env` está no `.gitignore:3` e `catalogo/.env` não entra na imagem (Dockerfile copia pastas explícitas). Ressalva: `usuarios/src/config/env.ts:10-11` tem outro padrão de segredo, só vale fora do compose. Risco real: ordem de subida (mongo/redis sem healthcheck) e `up -d` retornar antes de o sistema estar pronto |
| 7 | cache Redis | NÃO existe: sem serviço Redis no compose, sem dependência no `catalogo/package.json:13-20`, sem `REDIS_URL` em `catalogo/src/config/env.ts:4-14` | tudo (RF06–RF08) |

### Lacunas de log (RN04/RN05)
- Não existe log de requisição HTTP em nenhum serviço (`*/src/index.ts`): o slide "UMA COMPRA, CINCO SERVIÇOS, UM ID" mostra a linha `POST /orders | x-request-id=`. Adicionar middleware de log (método, caminho, status, `x-request-id`), pulando `/health`, no pedidos (obrigatório, é onde a compra entra) e nos demais serviços HTTP.
- Falta linha "recebeu": nenhum consumer loga o recebimento genérico. Pedidos loga só no handler (`pedido.service.ts:139`), catalogo só "publicado"/"ignorado" (`reserva.service.ts:38,103,133`), notificacoes só depois de enviar o e-mail (`notificacao.service.ts:22`). Recomendado: uma linha única em `iniciarConsumer` de cada serviço (`*/src/config/kafka.ts:115-138`) no formato `[correlationId=X] recebido <tipo> pedidoId=Y topico=T`, e remover a duplicata do pedidos (`pedido.service.ts:139,163,186`) ou manter só uma delas.
- Evento inválido: `[correlationId=-] evento inválido descartado topico=.. offset=..` (`*/src/config/kafka.ts:119-121`) não tem `pedidoId` (o envelope não pôde ser lido). Aceito e documentado; tentar extrair `pedidoId`/`correlationId` do JSON bruto quando possível.
- Log de erro 500 sem `x-request-id`: `usuarios/src/middleware/errorHandler.ts:50` e `catalogo/src/middleware/errorHandler.ts:59` (pedidos, pagamentos e banco-falso já têm). O mesmo log imprime o objeto de erro inteiro (erros do Prisma podem carregar os argumentos da consulta, ex.: e-mail): registrar só `name`/`code`/`message` saneados.
- `*/src/config/kafka.ts:132-136` e `pagamentos/src/banco.ts:181`, `pagamento.service.ts:213` imprimem o objeto `erro` inteiro (risco menor, erros de Kafka/rede): idem, preferir mensagem.
- banco-falso: logs `[Banco] ...` têm a referência (= `pedidoId`) mas não o `x-request-id` que o pagamentos envia (`pagamentos/src/banco.ts:70`). Opcional para o RF05 (os 4 serviços já aparecem sem ele).
- Kong: o log de acesso padrão não tem o `X-Request-Id`. Opcional: `KONG_NGINX_HTTP_LOG_FORMAT` + `KONG_PROXY_ACCESS_LOG=/dev/stdout <formato>` com `$http_x_request_id` (ver Referências; validar em execução, a doc usa o cabeçalho padrão `Kong-Request-ID`).
- Dado pessoal: `usuarios/prisma/seed.ts:28,30,62,64` loga e-mails completos dos usuários do seed (dados de seed, não de cliente real; baixo risco; opcional logar só o perfil).
- `/health` fora do log: hoje satisfeito (nenhum access log nos serviços); precisa continuar assim ao adicionar o middleware (RF04).

### Checagem dos "TODOS OS REQUISITOS 1/6 a 6/6" (slides 37–42)
Verificado por leitura de código/compose/Kong nesta spec; as rotas e regras de 2/6–5/6 já foram revisadas nas entregas das aulas 06–09 (`docs/features/kafka-eventos/06-revisao-*.md`) e aqui só foram conferidas por amostragem (listas de rotas e Kong).

| Bloco | Peça | Situação | Arquivo:linha |
|---|---|---|---|
| 1/6 Infra | serviços + um banco por serviço, Kafka KRaft, Kafka UI, Mailpit, banco-falso, Kong | OK | `docker-compose.yml:7-293` |
| 1/6 | Redis | FALTA | (inexistente) |
| 1/6 Portas | só Kong 8080/8001/8002, Kafka UI, Mailpit 8025, banco-falso 9000; serviços e bancos sem `ports` | OK (Kafka UI está em 8090; a aula não fixa o número) | `docker-compose.yml:11-14, 189-190, 206-207, 285-286` |
| 1/6 Subida sozinha | migrações, seeds, tópicos idempotentes | OK | ver item 6 acima |
| 1/6 | serviços esperam banco e Kafka com `depends_on` healthy | PARCIAL: postgres e kafka sim; mongo, catalogo, banco-falso, mailpit, gateway não | `docker-compose.yml:32-36, 100-101, 143-144, 228-229, 272-273` |
| 1/6 | variáveis com padrão, sem `.env` fora do git | OK | `docker-compose.yml:31, 70`; `.env.example` |
| 1/6 Seeds | admin/cliente (com endereço), 3 categorias, 11 produtos com atributos distintos e estoque | OK | `usuarios/prisma/seed.ts`; `catalogo/seeds/seed.ts:37-190` |
| 1/6 Erros | `{ erro, detalhes }`, sem stack nem `senha_hash` | OK nos serviços; os health atuais respondem `{status, ...}` (corrigido pelo RF01). Respostas 401/403/404/429 geradas pelo Kong vêm como `{ "message": ... }` (limitação já documentada em `README.md:261`; a aula não pede mudar) | `*/src/middleware/errorHandler.ts` |
| 1/6 Repositório | README, ADRs em `docs/adr/`, pasta `http/`, tag `entrega-final` | FALTA: `docs/adr/`, `http/`, tag (nenhuma em `.git/refs/tags`) | — |
| 2/6 usuarios | tabelas, rotas públicas/logadas/admin, JWT HS256 com `sub,email,perfil,exp 2h` | OK | `usuarios/src/controllers/*.ts`; `kong/kong.yml:13-53` |
| 3/6 catalogo | rotas públicas/admin, consumer `pedido.criado`, `pagamento.*`, `pedido.cancelado`, reservas com `pedidoId` único | OK | `catalogo/src/routes/routes.ts`; `catalogo/src/consumers/pedidos.consumer.ts:32-39` |
| 3/6 Cache | cache-aside, TTL, invalidação, `X-Cache` | FALTA | `catalogo/src/controllers/produto.controller.ts:22-58`, `categoria.controller.ts:12-22` |
| 4/6 pedidos | carrinho, checkout 202/400/409/503, GET, cancelar 409, status por evento | OK | `pedidos/src/controllers/*.ts`; `pedido.service.ts:33-283` |
| 5/6 pagamentos/banco-falso | rotas, resiliência (timeout 2 s, retry 3x, opossum), estado do circuito no health | OK; estado do circuito existe, mas no formato/chave antigos (`circuitoBancoExterno`, minúsculas) | `pagamentos/src/banco.ts:11-17,123-142`; `health.controller.ts:10-13` |
| 6/6 Kong | sem banco, jwt `key_claim_name: perfil`, consumers cliente/admin, correlation-id, rate-limit 10/min por IP no login, apaga/injeta `X-User-*`, `/health/<servico>` público | OK para os 4 serviços HTTP; FALTA `/health/notificacoes` (D03) | `kong/kong.yml:21-27, 39-47, 55-62, 81-88, 100-107, 128-135, 139-154, 159-197` |
| 6/6 Kafka | tópicos `pedidos/estoque/pagamentos`, envelope `{id,tipo,pedidoId,ocorridoEm,correlationId,dados}`, chave = pedidoId, um group por serviço | OK | `*/src/utils/eventos.ts:21-28`; `*/src/config/kafka.ts:77,108` |
| 6/6 notificacoes | sem banco/rota no Kong; e-mails (recebido, insuficiente, aprovado, recusado, estornado) | OK | `notificacoes/src/consumers/eventos.consumer.ts:62-70` |
| 6/6 /health | todos os serviços, 200/503 | FALTA (RF01) | ver item 1 |
| 6/6 healthcheck e logs | compose healthy; linhas com pedidoId+correlationId | FALTA healthcheck; logs PARCIAL | ver itens 2 e 3 |

### Gaps por serviço (resumo)
- **usuarios**: health (formato, 503, só banco); `errorHandler.ts:50` sem x-request-id e com objeto cru; sem request log; healthcheck no compose (`docker-compose.yml:59-75`).
- **catalogo**: health (Mongo ping, Kafka, Redis, 3 estados); cache (novo `config/redis.ts`, serviço de cache, controllers/serviços de produto e categoria); invalidação nos consumers (`reserva.service.ts:27-149`) e nas escritas (`produto.service.ts:36-99`, `categoria.service.ts:17-25`); `?ids=` fora do cache; INCR na subida depois do seed; "recebeu"; `errorHandler.ts:59`; `env.ts` (REDIS_URL, TTL); `package.json` (ioredis); compose (healthcheck, Redis, depends_on); `GET /produtos/:id` devolve produto inativo (`produto.repository.ts:32-40`), comportamento atual mantido, só invalidar no soft delete.
- **pedidos**: health (banco + Kafka, sem catálogo); request log com `x-request-id` (controla a entrada da compra, `pedido.controller.ts:23`); "recebeu" duplicado/uniforme; healthcheck; `depends_on` catalogo hoje `service_started`.
- **pagamentos**: health (3 estados, Kafka, `circuitoBancoCartao`); "recebeu"; healthcheck; `depends_on` banco-falso `service_healthy`.
- **notificacoes**: HTTP mínimo (`node:http`, porta 3000) só para `/health`; `smtp.verify()` com limite de tempo para o estado `degradado`; "recebeu"; healthcheck; `EXPOSE` opcional; Kong `/health/notificacoes` (D03).
- **banco-falso**: `/health` no formato novo (manter 200 sempre); `x-request-id` nos logs; healthcheck.
- **kong**: rota `/health/notificacoes`; healthcheck do gateway (`kong health`); opcional: formato de log com `X-Request-Id`.
- **raiz**: serviço `redis`; healthchecks; `depends_on` com `service_healthy`; gateway depende de todos; README; `docs/adr/`; `http/fluxo-completo.http`; `.env.example` (comentário: `.env` é opcional); tag.

## Healthcheck no compose (RF03)
- `test`: `node -e` com `fetch('http://127.0.0.1:3000/health')` saindo com 0 se `r.ok` e 1 caso contrário (200 e degradado = healthy; 503 = unhealthy). A imagem `node:22-slim` não traz `wget` nem `curl` (comportamento conhecido da imagem slim; NÃO verificado nesta spec por falta de Docker no ambiente do pesquisador: o dev deve conferir com `docker run --rm node:22-slim sh -c "which wget curl"`). Como a decisão não depende do resultado, usar `node -e` em todos; o Node 22 tem `fetch` nativo. Usar `127.0.0.1` (o Express escuta em `::` dual-stack, funciona).
- `interval: 10s`, `timeout: 3s`, `retries: 3`, `start_period: 40s` (migração + seed + Kafka; a aula usa 30 s no exemplo) nos 6 serviços de aplicação.
- Infra: gateway `kong health`; mongo `mongosh --quiet --eval "db.adminCommand('ping')"` (a imagem `mongo:7-jammy` traz o `mongosh`); redis `redis-cli ping`; mailpit `/mailpit readyz` (a imagem já declara HEALTHCHECK próprio; conferir em execução); postgres e kafka já têm.
- `depends_on` `service_healthy`: usuarios→postgres-usuarios (já); catalogo→mongo-catalogo, kafka, redis; pedidos→postgres-pedidos, kafka (catalogo NÃO: só chama em tempo de execução e o checkout já devolve 503); pagamentos→postgres-pagamentos, kafka, banco-falso; notificacoes→kafka, mailpit; kafka-ui→kafka (já); gateway→usuarios, catalogo, pedidos, pagamentos, notificacoes (assim o gateway é o último e `up -d` só retorna com o sistema pronto, o que sustenta "roda o .http logo depois de um único comando").
- Postgres (5 s/5 s/5) e kafka (10 s/10 s/10) mantêm os valores atuais: são infraestrutura, a aula exige 10 s/3 s/3 para "cada serviço".

## Cache Redis (RF06–RF08)
- Compose: serviço `redis` (`redis:7-alpine`), `command` com `--save ""` e `--appendonly no` (e, recomendado, `--maxmemory` com `allkeys-lru` como política de descarte), sem `volumes`, sem `ports`, na `ecommerce-net`, com healthcheck `redis-cli ping`. A imagem declara `VOLUME /data` (volume anônimo), mas sem `save`/`appendonly` nada é gravado; `down -v` o remove.
- Cliente: `ioredis` (a sintaxe `set(chave, valor, 'EX', ttl)` do slide "O PADRÃO CACHE-ASIDE" é a dele), configurado para falhar rápido: sem fila offline, 1 tentativa por comando, `commandTimeout` curto (~200 ms) e reconexão em segundo plano; falha de conexão na subida não derruba o catálogo.
- Camadas (CLAUDE.md): `catalogo/src/config/redis.ts` (cliente) → `catalogo/src/services/cache.service.ts` (`lerOuBuscar(chave, buscar)` devolvendo `{ valor, cache: 'HIT'|'MISS'|'OFF' }`, `invalidarVitrine()` com `INCR`, `redisDisponivel()` para o health) → `produto.service.ts`/`categoria.service.ts`/`reserva.service.ts`. Controllers só colocam o header `X-Cache` (hoje chamam o service e devolvem `res.json`: `produto.controller.ts:32-39,52-53`, `categoria.controller.ts:16-17`).
- Leitura: (1) lê `catalogo:versao` (ausente = 0); (2) monta a chave com a versão; (3) `GET`: achou → `HIT`, devolve o JSON exato; (4) não achou → `MISS`: busca no Mongo, grava com `EX` TTL, devolve; (5) qualquer erro de Redis em (1)–(4) → busca no Mongo e responde com `X-Cache: OFF`.
- Escrita: depois do sucesso no Mongo, `INCR catalogo:versao`. Erro do Redis na invalidação: log de aviso com `pedidoId`/`correlationId` quando houver, sem lançar (o consumer não pode pedir reentrega ao Kafka por causa de cache).
- Pontos de invalidação: `createProdutoService`, `updateProdutoService`, `ajustarEstoqueService`, `desativarProdutoService` (`produto.service.ts:36-99`); `createCategoriaService` (`categoria.service.ts:17-25`); `reservarEstoqueDoPedidoService` (só quando criou a reserva e mexeu no estoque, `reserva.service.ts:27-92`), `confirmarReservaService` (`:99-115`, o `reservado` aparece na vitrine) e `liberarReservaService` (`:119-149`); uma vez por evento, não por item. Subida do catálogo: `INCR` depois do seed (`catalogo/Dockerfile:38` roda o seed antes do `index.ts`; o seed altera dados com Redis possivelmente ainda com cache de uma subida anterior).
- Não cachear: `GET /produtos?ids=` (checkout, carrinho), respostas de erro, qualquer rota de escrita.
- Redis fora: `X-Cache: OFF` em todas as três rotas e `dependencias.cache = "fora"` no health (status `degradado`, 200).
- Header: `X-Cache` passa pelo Kong sem configuração (`kong/kong.yml:68-72`). `?ids=` não envia o header (decisão D06).

## Decisões assumidas
- D01 — Perfil/precedência: `aulas-ecommerce`; a aula vence o CLAUDE.md quando contradiz (CLAUDE.md:18). Divergências registradas em D02, D03, D04.
- D02 — Local do arquivo de fluxo: a aula é explícita e repetida (slides "O QUE ENTREGAR", "O QUE ENTREGAR 3/3", "REQUISITO Nº 1" e "TODOS OS REQUISITOS 1/6": `http/fluxo-completo.http`, "pasta http/ com os .http"). O CLAUDE.md:124-125 manda manter `requests/`. Decisão: criar UM só arquivo, `http/fluxo-completo.http` (o que o avaliador abrirá), sem cópia em `requests/` (duas cópias divergem). Os `.http` existentes ficam em `requests/` e o README os lista (`fluxo-compra.http` continua com a saga detalhada e o `demos.http` com a resiliência). Um arquivo novo de demonstração de saúde e cache (health de todos os serviços, MISS/HIT/OFF, preço novo depois de `PUT`) entra em `requests/observabilidade.http` (convenção do projeto). Mover os demais `.http` para `http/` não faz parte do escopo (confirmar, ver Perguntas). Propor ao usuário ajustar o CLAUDE.md:124-125 (o pesquisador não altera esse arquivo).
- D03 — Notificações no Kong: a aula diz "sem rota no Kong" (bloco 6/6, notificacoes) e também "pelo Kong: `/health/<servico>`, sem token" e "/health em todos os serviços". Decisão: notificacoes ganha só a rota pública `/health/notificacoes` (nada de rota de negócio), e o `/health` interno é o que o Docker chama. Para isso abre um `node:http` mínimo na 3000 interna, sem `ports` e sem Express.
- D04 — ADRs: `docs/adr/` (aula) em vez de dentro do README (CLAUDE.md:104). Migrar os ADRs 001–009 do `README.md:288-322` para um arquivo cada (`NNNN-titulo.md`, com Contexto, Decisão, Consequências; os 001–007 hoje não têm "Contexto"), criar ADRs novos 010 (health de 3 estados e logs correlacionados; health não chama outros serviços), 011 (cache Redis cache-aside com versão; o que nunca cachear; GET /pedidos/:id não cacheia) e 012 (subida do zero: defaults no compose, healthchecks, `service_healthy`, gateway por último). No README, trocar o texto dos ADRs por um índice com links. Mínimo aceito pela aula: 3 arquivos; migrar todos evita README duplicado.
- D05 — Nome e valores do circuito: chave `circuitoBancoCartao` e valores `FECHADO|ABERTO|MEIO-ABERTO`, como no exemplo da aula (slide "HEALTH CHECK"), em vez de `circuitoBancoExterno` e minúsculas (`pagamentos/src/banco.ts:138-142`; README e `requests/demos.http` citam o nome antigo e devem ser atualizados). `MEIO-ABERTO` conta como `degradado`.
- D06 — `GET /produtos?ids=` não usa cache e não envia `X-Cache` (a aula só prevê HIT/MISS/OFF para a vitrine; `OFF` significaria "Redis fora"). Motivo: preço e `ativo` do checkout precisam ser os de agora (slide "O QUE CACHEAR": "a reserva decide no banco"; resposta 3: "no checkout o preço é sempre consultado no catálogo, não no cache da vitrine").
- D07 — Só `/health` (sem `/health/live` e `/health/ready`): a aula diz "No projeto, um /health com os três estados basta" (slide "VIVO × PRONTO").
- D08 — Estado do Kafka no health: teste real com o admin do kafkajs (`describeCluster`/`listTopics`) com limite de ~2 s e resultado reaproveitado por poucos segundos (o health é chamado a cada 10 s por réplica do Docker e por quem consultar). Banco: `SELECT 1` (Prisma `$queryRaw`) e `ping` do Mongo, também limitados a ~2 s (Prisma pode esperar bem mais que os 3 s do Docker se o Postgres estiver parado).
- D09 — SMTP fora = `degradado` (notificacoes ainda consome; o e-mail falha e o kafkajs reentrega), nunca 503.
- D10 — TTL 60 s (referência da aula) com variação aleatória pequena; `CACHE_TTL_SEGUNDOS` configurável. 404 não é cacheado.
- D11 — Cenário "cancelamento com estorno" no `.http`: o estorno só ocorre se o cancelamento chega com a cobrança em andamento (cancelar `PAGO` dá 409). Para ficar repetível, o `.http` liga `latenciaMs` ~1800 no banco-falso (abaixo do timeout de 2 s de `pagamentos/src/banco.ts:11`), faz o checkout e cancela logo em seguida; o consumer processa um evento por vez, então o `pedido.cancelado` espera a cobrança terminar e estorna (`README.md:240`). O resultado esperado é `ESTORNADO` (ou `CANCELADO` se o cancelamento ganhar a corrida); em ambos o pedido é `CANCELADO` e o estoque volta. No final, volta a latência para 0. Se o cancelamento demorar demais, vem 409 e o README manda repetir.
- D12 — Produto do fluxo: `GET /produtos?categoria=livros` e `$[0]._id` via `# @name` (nenhum id fixo; todos os livros do seed têm estoque ≥ 18, `catalogo/seeds/seed.ts:162-190`, e o fluxo consome 1 unidade por execução). O Mongo devolve `_id` (a aula usa `id` no exemplo; o projeto não muda o contrato). Corpo do carrinho segue o contrato atual (`produto_id`, `quantidade`), diferente do `produtoId` do exemplo da aula.
- D13 — Login com rate-limit do Kong (10/min por IP): o fluxo faz só 1 login de cliente, bem abaixo do limite.
- D14 — Diagrama em Mermaid no README (renderiza no GitHub), com exatamente os 15 containers do compose: gateway, usuarios, catalogo, pedidos, pagamentos, notificacoes, postgres-usuarios, mongo-catalogo, postgres-pedidos, postgres-pagamentos, redis, kafka, kafka-ui, mailpit, banco-falso; tópicos `pedidos`, `estoque`, `pagamentos` no Kafka.
- D15 — Respostas às perguntas de discussão que impactam a implementação: (1) health do pedidos não chama o catálogo (RN01, ADR 010); (2) pedido que chega com o banco do estoque fora: neste projeto o catálogo relança o erro e o kafkajs reentrega (`catalogo/src/config/kafka.ts:129-137`), então o evento não se perde por esse caminho; o que continua como limitação é a ausência de DLQ (evento inválido é descartado, `kafka.ts:119-122`; erro persistente reentrega em laço e bloqueia a partição) e a reserva parcial (`README.md:235`), ambas listadas em "Limitações conhecidas"; (3) preço antigo na vitrine: zero se a invalidação funcionar, no máximo 60 s (TTL) se o Redis estava fora no instante da escrita; no checkout o preço vem sempre do catálogo (ADR 011); (4) `GET /pedidos/:id` NÃO é cacheado (ADR 011).
- D16 — Limitações novas a listar no README: sem DLQ nem Outbox (já listadas), cache por réplica de circuito (já), health do Kafka por amostragem, `INCR` perdido se Redis estiver fora (TTL cobre até 60 s), Redis sem persistência (vitrine esfria a cada reinício), sem métricas e traces (Prometheus/Grafana/Jaeger ficam para a próxima aula: slide "OS TRÊS PILARES"), Kafka UI/Mailpit/banco-falso sem autenticação (já).

## Teste de aceite (pronto quando)
- `docker compose down -v && docker compose up -d --build` termina sem passo manual e `docker compose ps` mostra todos `(healthy)`.
- `http/fluxo-completo.http` roda de cima para baixo, sem editar, em um clone novo: pedido chega a `PAGO`, pagamento `APROVADO`; cartão 0002 → `CANCELADO` com estoque de volta; cancelamento → estoque de volta; cliente em `GET /usuarios` → 403.
- `docker compose logs | grep <X-Request-Id>` mostra a compra em pedidos, catalogo, pagamentos e notificacoes (pelo menos 4 serviços), sem `/health` no log e sem senha, token, cartão ou e-mail completo.
- Parar `postgres-pagamentos`: `GET /health/pagamentos` 503 e `unhealthy` em ~30 s. `falhaPercent: 100` + compras: circuito `ABERTO` e `degradado` 200.
- Cache: `MISS` depois `HIT`; admin muda o preço e o próximo GET já traz o novo; `docker compose stop redis`: vitrine responde com `X-Cache: OFF` e `/health/catalogo` `degradado` 200; estoque muda por compra: a vitrine reflete.
- `docker compose config --quiet` sem erro; `npx tsc --noEmit` e `npm run build` em cada serviço alterado (usuarios, pedidos, pagamentos com `prisma validate` e `generate`).

## Referências
- Aula: `aulas/texto/10-observabilidade-e-cache.txt` (slides "HEALTH CHECK", "VIVO × PRONTO", "O DOCKER DE OLHO", "UMA COMPRA, CINCO SERVIÇOS, UM ID", "O PADRÃO CACHE-ASIDE", "VERSÃO NA PRÁTICA 1/2 e 2/2", "AS ARMADILHAS DO CACHE", "O QUE ENTREGAR 1/3, 2/3, 3/3", "UM README QUE FUNCIONA", "TODOS OS REQUISITOS 1/6 a 6/6", "ANTES DE ENTREGAR").
- Specs anteriores: `docs/features/kafka-eventos/01-spec.md`, `docs/features/saga-pagamentos/01-spec.md`.
- Kong, logs com correlation id: https://developer.konghq.com/how-to/add-correlation-ids-to-gateway-logs/
- Mailpit na Docker Hub (healthcheck e `readyz`): https://hub.docker.com/r/axllent/mailpit
- Compose `depends_on` com `condition: service_healthy`: https://docs.docker.com/compose/how-tos/startup-order/
- Redis, persistência (`save`, `appendonly`): https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/
- ioredis: https://github.com/redis/ioredis
- kafkajs Admin (`describeCluster`, `listTopics`): https://kafka.js.org/docs/admin

## Perguntas em aberto
Nenhuma bloqueia a implementação (nenhuma regra de negócio crítica falta). Confirmar, se discordar de uma decisão assumida:
1. D02: um só `http/fluxo-completo.http` + `requests/observabilidade.http`, sem mover os `.http` antigos de `requests/` para `http/`. Quer também mover/copiar os demais para `http/` (a aula, bloco 1/6, fala em "pasta http/ com os .http") e atualizar o CLAUDE.md:124-125?
2. D03: expor `/health/notificacoes` no Kong e abrir HTTP mínimo no serviço de notificações (a aula também diz "sem rota no Kong").
3. D04: migrar os 9 ADRs do README para `docs/adr/` (mais 3 novos) e deixar índice no README, em vez de só criar 3 ADRs novos.
4. D05: renomear `circuitoBancoExterno` para `circuitoBancoCartao` (e valores em maiúsculas) como no exemplo do slide.
