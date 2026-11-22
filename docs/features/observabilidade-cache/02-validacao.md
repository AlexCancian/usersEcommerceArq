# Validação da spec: observabilidade-cache (aula 10, entrega final)
Data: 22/11/2026
Veredito: APROVADA (com os ajustes técnicos A01–A09 abaixo, já incorporados ao contrato `03` e ao plano `04`)

Perfil: `aulas-ecommerce` (CLAUDE.md da raiz). Fonte da verdade: `aulas/texto/10-observabilidade-e-cache.txt`. Decisões D01–D16 da spec aceitas pelo usuário (http/fluxo-completo.http só em `http/`, `requests/observabilidade.http`, rota Kong só `/health/notificacoes`, ADRs migrados para `docs/adr/` + 3 novos, `circuitoBancoCartao` com `FECHADO|ABERTO|MEIO-ABERTO`, `?ids=` fora do cache, `node -e fetch` nos healthchecks).

| Item | Resultado | Observação |
|---|---|---|
| Spec com Status PRONTA | OK | `01-spec.md:2`. Perguntas em aberto não bloqueiam e foram respondidas pelo usuário. |
| Toda RN coberta por RF | OK | RN01–RN03 → RF01, RF02, RF03 · RN04–RN05 → RF04, RF05 · RN06–RN07 → RF06 · RN08 → RF07 · RN09 → RF03, RF08, RF09. RF10/RF11 são entregáveis de documentação/versão (slide "O QUE ENTREGAR"). |
| Todo RF com critério verificável | OK | Seção "Teste de aceite" da spec + critérios do `04`. RF11 (tag) depende de pedido explícito do usuário: fica como pendência, não como critério do dev. |
| Tipos compatíveis com driver(s) alvo | OK | Nenhuma tabela, coleção ou migration nova. Redis: só strings (`INCR` em `catalogo:versao`, JSON serializado nas chaves de vitrine). `npx prisma validate/generate` continua obrigatório em usuarios, pedidos e pagamentos (sem mudança de schema). |
| Sem conflito com código existente | OK com ajustes | Ver "Conflitos resolvidos". Nenhum nome de rota novo colide (`/health/notificacoes` é novo; `/health` já existe em 5 serviços). `circuitoBancoExterno` é citado em `README.md:153,207`, `requests/demos.http:26`, `requests/pagamentos.http:15` → atualizar junto. |
| Segurança explícita (papéis, dados sensíveis) | OK com ajustes | `/health/*` público (só estados, sem versão/host/mensagem). Redis sem porta. Logs sem senha, JWT, cartão, CPF, e-mail. Ajustes A03, A04 e A05 fecham vazamentos por mensagem de erro e por `X-Request-Id` forjado. |
| Concorrência | OK | Versão lida antes do Mongo; `INCR` depois da escrita; invalidação nunca relança (consumer não reentrega por cache); busca no Mongo no máximo uma vez por requisição (A06). Checagens do health em paralelo com limite e coalescência. |
| Fuso | OK | Sem data de negócio nova; `ocorridoEm` já em ISO UTC; logs do Docker com `-t` (UTC). |

## Conflitos resolvidos (registrados; a aula vence o CLAUDE.md, CLAUDE.md:18)
1. **Formato de erro × /health**: o CLAUDE.md manda `{ erro, detalhes? }` em todo erro; o `/health` com `fora do ar` responde 503 com `{ servico, status, dependencias }` (slide "HEALTH CHECK"). O `/health` é exceção documentada no contrato; todos os outros 503 continuam `{ erro }`.
2. **`http/` × `requests/`** (CLAUDE.md:124-125): só `http/fluxo-completo.http` vai para `http/` (D02). Sugerir ao usuário ajustar o CLAUDE.md:124-125 (o arquiteto não altera esse arquivo).
3. **ADRs no README × `docs/adr/`** (CLAUDE.md:104): ADRs passam a `docs/adr/` (D04); o README fica com índice. Sugerir ajuste no CLAUDE.md:104.
4. **notificacoes "sem rota no Kong"**: só a rota pública de health (D03).

## Ajustes técnicos do arquiteto (incorporados ao 03/04)
- **A01 — Política de descarte do Redis**: a spec recomenda `allkeys-lru`, que pode despejar `catalogo:versao` (a única chave sem TTL): a versão voltaria a 0 e chaves `v0` antigas, ainda dentro do TTL, poderiam ser servidas. Usar `--maxmemory 64mb --maxmemory-policy volatile-lru` (só despeja chaves com TTL, ou seja, as de vitrine).
- **A02 — Startup do catálogo e o `INCR` pós-seed**: com `enableOfflineQueue: false`, um `INCR` emitido antes do evento `ready` do ioredis falha na hora. Na subida, aguardar `ready` por no máximo 2 s antes do `INCR`; se não ficar pronto, logar aviso e seguir (o TTL cobre).
- **A03 — Erro de SMTP no log**: mensagens do nodemailer podem conter o endereço do destinatário (ex.: "recipients were rejected: <x@y>"). Em notificacoes, logar só `name`, `code` e `responseCode` do erro, nunca `message`.
- **A04 — Erro do Prisma no log**: `PrismaClientValidationError` traz os argumentos da consulta na mensagem (pode conter e-mail). Erros do Prisma/Mongo: logar só `name` e `code`. Demais erros: `name: message` truncado em 200 caracteres.
- **A05 — `X-Request-Id` vindo do cliente**: o plugin correlation-id do Kong preserva o cabeçalho se o cliente o enviar; um valor com quebra de linha forjaria linhas de log. Aceitar só `^[A-Za-z0-9-]{1,64}$`; fora disso, tratar como ausente (`-` no log; no pedidos, `randomUUID()` como hoje).
- **A06 — Cache-aside sem busca dupla**: no slide, se o `GET` do Redis falhar o código chama `buscar()` no `catch`; se o erro vier do próprio `buscar()` (ex.: 404), ele não pode ser engolido como `OFF` nem executado de novo. Erros do Redis e erros da busca ficam em blocos separados; `buscar()` roda no máximo uma vez; erro do `SET` depois do MISS não quebra a resposta (responde `OFF`).
- **A07 — Latência do cenário de estorno**: a spec sugere ~1800 ms; com timeout de 2000 ms em `pagamentos/src/banco.ts:11`, a folga de 200 ms pode gerar timeout e retry (cobrança "incerta"). Usar 1500 ms, valor já comprovado em `requests/fluxo-compra.http:160-166`.
- **A08 — Corpo cacheado como texto**: o cache guarda e devolve a string JSON exata (`res.type("application/json").send(json)`), evitando tipar documento Mongoose × objeto parseado e serializar duas vezes.
- **A09 — Linha "recebeu" só para tipos tratados**: notificacoes, catálogo e pedidos assinam tópicos com tipos que não tratam; logar `recebeu` só quando existe handler (evita ruído).

## Riscos que o orquestrador deve conferir
- O hook do dev-backend pode não permitir escrita em `http/` e `docs/adr/` (CLAUDE.md:110 lista serviços, kong, compose, requests, README, .env.example). Liberar esses dois caminhos para esta feature.
- `catalogo/package-lock.json` precisa ser atualizado por `npm install ioredis@5` (o Dockerfile usa `npm ci`).
- Healthchecks e o comportamento de `up -d` só são verificáveis com Docker (pendência do usuário).

## Motivos da reprovação
- Nenhum.
