# ADR 0011: Cache Redis (cache-aside com versão) na vitrine do catálogo

Status: aceita (aula 10)

## Contexto
A vitrine (`GET /produtos`, `GET /produtos/:id`, `GET /categorias`) é lida o tempo todo e muda pouco. Cada leitura ia ao MongoDB. O cache acelera, mas dado velho pode custar dinheiro (preço antigo) e o cache não pode derrubar a vitrine.

## Decisão
- **Cache-aside** no `catalogo`, com Redis 7 (`ioredis`): lê do Redis; no MISS busca no Mongo e grava com TTL.
- **Invalidação por versão**: as chaves levam a versão (`catalogo:v<N>:produtos:...`). Qualquer escrita relevante faz `INCR catalogo:versao` depois de gravar no Mongo; as chaves antigas ficam órfãs e expiram sozinhas. Nada de apagar chaves por padrão.
- Invalida em toda escrita de produto e categoria, na reserva, confirmação e devolução de estoque (uma vez por operação, nunca por item) e na subida do catálogo (depois do seed).
- TTL de 60 s (`CACHE_TTL_SEGUNDOS`) + 0 a 9 s aleatórios, para as chaves não expirarem juntas.
- Cabeçalho `X-Cache`: `HIT`, `MISS` ou `OFF` (Redis fora). O corpo é idêntico nos três casos (o JSON é guardado como texto).
- **Nunca cacheia**: `GET /produtos?ids=` (o checkout precisa do preço e do `ativo` de agora), 404 e 400, carrinho, pedidos, `GET /pedidos/:id` (o cliente consulta justamente para ver o status mudar) e pagamentos.
- **Redis falha, a vitrine continua**: sem fila offline, sem retry por comando, `commandTimeout` de 200 ms; erro vira `X-Cache: OFF` e `degradado` no health. Falha na invalidação é logada e engolida (o consumer não relança por causa de cache).
- Redis **sem persistência** (`--save ""`, `--appendonly no`), sem volume, sem porta, `maxmemory 64mb` com `volatile-lru`: só chaves com TTL são despejadas, protegendo `catalogo:versao`, que não tem TTL.

## Consequências
- Preço velho na vitrine: zero se a invalidação funcionar; no máximo o TTL (60 a 69 s) se o Redis estava inalcançável no instante da escrita. No checkout o preço sempre vem do catálogo, então ninguém paga o preço velho.
- Reiniciar o Redis esfria o cache (versão e chaves somem juntas, e nada velho volta).
- A versão é lida antes do Mongo: uma resposta montada com dado velho fica na chave da versão antiga, que ninguém mais lê.
- Mais um container e uma dependência não essencial no health do catálogo.
- O cache existe só na vitrine; nenhum outro serviço tem cache.
