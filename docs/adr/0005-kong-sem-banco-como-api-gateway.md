# ADR 0005: Kong sem banco como API Gateway

Status: aceita (aula 07)

## Contexto
Sem gateway, cada serviço teria de validar JWT, aplicar rate limit e publicar porta. A autenticação se repetiria e qualquer serviço mal configurado ficaria exposto.

## Decisão
- Kong 3.9 em modo declarativo (`kong/kong.yml` versionado, sem banco de configuração).
- Três níveis de acesso por rota: `publico` (sem plugin), `logado` (jwt, 401) e `admin` (jwt + acl `allow: [admin]`, 403).
- Os consumers são **perfis** (`cliente`, `admin`), não pessoas: o plugin jwt acha o consumer pelo campo `perfil` do token (`key_claim_name: perfil`). Perfil inventado dá 401.
- Só `usuarios` emite JWT (HS256). Os demais serviços não validam token: leem `X-User-Id`, `X-User-Email` e `X-User-Role`, que o Kong injeta depois do jwt e do acl. O Kong apaga esses cabeçalhos quando vêm do cliente.
- Plugin global `correlation-id` gera o `X-Request-Id` de cada requisição.
- Só o gateway publica portas (exceções: ADR 0007 e 0009).

## Consequências
- Autenticação e autorização de rota num lugar só; serviços ficam simples.
- Os serviços confiam nos cabeçalhos `X-User-*`: isso só é seguro porque nada de fora alcança a rede interna. Quem publicar uma porta de serviço quebra essa garantia.
- O gateway é ponto único de falha. Mudar o `kong.yml` exige `docker compose restart gateway`. Um novo perfil (ex.: estoquista) exige consumer e grupo novos: é decisão de arquitetura, não cadastro.
- Erros do gateway (401, 403, 429) saem no formato do Kong (`{ "message": ... }`), diferente do `{ "erro": ... }` dos serviços.
