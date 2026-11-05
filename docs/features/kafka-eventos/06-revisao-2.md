# Revisão: kafka-eventos
Data: 05/11/2026
Rodada: 2
Veredito: APROVADO

Perfil: `aulas-ecommerce` (CLAUDE.md da raiz). Conferido contra `aulas/texto/08-kafka-e-eventos.txt`, `01-spec.md`, `02-validacao.md`, `03-contrato-api.md`, `04-plano-backend.md` e `06-revisao-1.md`.

## Repositórios revisados
| Repositório | Perfil | Branch base | Arquivos alterados |
|---|---|---|---|
| `usersEcommerceArq` (raiz, um `.git`) | aulas-ecommerce (hook: api-express) | `main` (mudanças não commitadas) | Mesmo conjunto da rodada 1 (`git status --porcelain` idêntico; `git diff --stat`: 21 arquivos rastreados, +560/−44, mais os arquivos novos). Arquivos modificados **depois** de `06-revisao-1.md` (busca por mtime, fora de `node_modules`/`dist`/`.git`): só `pedidos/src/config/kafka.ts`, `catalogo/src/config/kafka.ts`, `notificacoes/src/config/kafka.ts` e `catalogo/src/services/reserva.service.ts`, que batem com o que o dev-backend informou |

## Comandos (por repositório)
| Pasta | Comando | Resultado | Resumo |
|---|---|---|---|
| `pedidos/` | `npx prisma validate` (`DATABASE_URL` inline) | PASSOU | "The schema at prisma\schema.prisma is valid" |
| `pedidos/` | `npx prisma generate` | PASSOU | exit 0 |
| `pedidos/` | `npx tsc --noEmit` | PASSOU | exit 0 |
| `pedidos/` | `npm run build` | PASSOU | exit 0 |
| `catalogo/` | `npx tsc --noEmit` | PASSOU | exit 0 |
| `catalogo/` | `npm run build` | PASSOU | exit 0 |
| `notificacoes/` | `npx tsc --noEmit` | PASSOU | exit 0 |
| `notificacoes/` | `npm run build` | PASSOU | exit 0 |
| raiz | `docker compose config --quiet` | PASSOU | exit 0 |
| — | `npm run lint` / `npm test` | N/A | scripts inexistentes |

Pendência para o usuário (inalterada): `docker compose up -d --build` e rodar as seções 6 e 7 de `requests/pedidos.http`.

## Bloqueante da rodada 1: verificação
| Item | Resultado | Local |
|---|---|---|
| Erro do handler logado com `correlationId` | OK (resolvido) | `pedidos/src/config/kafka.ts:129-137`, `catalogo/src/config/kafka.ts:129-137`, `notificacoes/src/config/kafka.ts:83-91`: `try { await tratar(envelope) } catch (erro) { console.error(\`[correlationId=${envelope.correlationId}] erro ao tratar ${envelope.tipo} pedidoId=... topico=... particao=... offset=... (será reentregue):\`, erro); throw erro; }` |
| Retry do kafkajs mantido | OK | `throw erro` relança dentro do `eachMessage`, então o offset não é commitado e o kafkajs reentrega. Nenhum `catch` nos consumers ou services engole erro de infraestrutura. Os únicos `catch` são o D04 (`pedido.service.ts:112`, publicação no checkout, que está fora do consumer) e o 11000 → `false` (`reserva.repository.ts:12-16`, que relança o resto) |
| Sem `any` | OK | `erro` é `unknown` (padrão TS strict); `partition` vem tipado de `EachMessagePayload`. Grep de `any`/`@ts-ignore` em `src/`: só arquivos legados que não estão no diff (`catalogo/src/middleware/errorHandler.ts`, `models/categoria.model.ts`, `utils/schemas.ts`, `models/produto.model.ts`) |
| Formato coerente com contrato/RF08 | OK | Prefixo `[correlationId=<id>]` igual aos logs de publicação e descarte; mensagem inválida segue descartada com `[correlationId=-]` (D06); tipo sem handler segue ignorado |
| A6 da aula 08 ("correlationId em todos os eventos e logs") | OK | Agora coberto também no caminho de erro |

## Sugestão aplicada da rodada 1
- `catalogo/src/services/reserva.service.ts:52-58`: o motivo é truncado com `.slice(0, 500)` na origem e fica coerente com `pedidos/src/utils/eventos.ts:63` (`.max(500)`). Ambos contam unidades UTF-16, então o evento não é mais descartado por causa de um nome longo. OK.

## Checklist (aula 08, comum e backend)
Mantido igual à rodada 1, que já tinha todos os itens OK/N/A com exceção de A6, comum #1 e comum #3. Esses três passam a **OK** com a correção acima. Nenhum outro arquivo foi alterado desde a rodada 1, então os demais itens seguem válidos: kong intocado, nenhuma porta nova além de 8080/8001/8002/8090/8025, nenhuma FK entre bancos e nenhum import entre serviços.

## Bloqueantes
### dev-backend
- Nenhum.

### dev-frontend
- N/A (sem frontend).

### arquiteto (contrato)
- Nenhum.

## Sugestões (não bloqueantes, ainda em aberto)
- `README.md` (Limitações): além da queda do catálogo, citar a falha ao **publicar** `estoque.*` com o Kafka fora depois de `concluirReserva`. Nesse caso a reentrega cai no 11000 e o pedido fica parado em `AGUARDANDO_ESTOQUE`.
- `pedidos/src/index.ts`, `catalogo/src/index.ts`, `notificacoes/src/index.ts`: `encerrar` não tem `try/catch`. Se `disconnect` lançar, vira unhandled rejection e o processo sai com código 1. Envolver em `try/finally` com `process.exit`.
- `docker-compose.yml` (mailpit): a imagem `axllent/mailpit` está sem tag (igual ao slide). Fixar a versão.
- D04: com o Kafka fora, o `producer.send` pode segurar o 202 por dezenas de segundos. Opcional: `retry`/`requestTimeout` menores no producer do pedidos.
- `requests/pedidos.http` e `requests/catalogo.http`: padronizar o espaço em `@var = {{...}}` (mudança anterior à feature).
