# ADR 0012: Subida do zero com um comando

Status: aceita (aula 10)

## Contexto
Um avaliador clona o repositório e roda o `.http`. Se for preciso criar `.env`, rodar migrations à mão, semear dados ou esperar "uns minutos", o trabalho não é avaliável. Além disso, um `up -d` que devolve o terminal antes de o sistema estar pronto faz a primeira requisição falhar.

## Decisão
- `docker compose up -d --build` coloca tudo no ar. Nenhuma variável é obrigatória: todas têm padrão no compose (`${JWT_SECRET:-...}`, `${REDIS_URL:-...}`, `${CACHE_TTL_SEGUNDOS:-60}`). O `.env` é opcional e está fora do git.
- Cada serviço aplica as próprias migrations (`prisma migrate deploy`) e seeds idempotentes ao iniciar; os serviços com Kafka criam os tópicos se não existirem. Rodar de novo não duplica nada.
- **Healthcheck** em todos os serviços (chamando o `/health` de dentro do container: 10 s, 3 s, 3 tentativas, `start_period` 40 s) e na infraestrutura (Kong, Mongo, Redis, Mailpit; Postgres e Kafka já tinham).
- `depends_on` com `condition: service_healthy` em toda dependência. O **gateway sobe por último**, só depois dos cinco serviços de que depende estarem saudáveis; assim, quando `up -d` retorna, o sistema está pronto.
- `pedidos` não depende do `catalogo` no compose: catálogo fora já vira 503 no checkout em tempo de execução.
- Nenhuma porta nova além das já documentadas.

## Consequências
- Um comando, nenhum passo escondido; `docker compose ps` mostra tudo `(healthy)`.
- A primeira subida é lenta (build, migrations, seeds e `start_period`), e um serviço preso em `unhealthy` impede o gateway de subir (visível no `docker compose ps`).
- O Docker só **marca** `unhealthy`; não reinicia o container. Reinício automático por saúde ficou fora.
- Os segredos padrão estão no compose e servem só para uso didático local; em produção viriam de um cofre.
