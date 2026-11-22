# ADR 0010: Health de três estados e logs correlacionados

Status: aceita (aula 10)

## Contexto
Com cinco serviços, quatro bancos, um broker e um sistema externo, "a compra não terminou" não diz em qual caixa está o problema. O Docker precisa saber quem está pronto, e quem opera precisa reconstruir uma compra a partir dos logs.

## Decisão
**Health**
- Todo serviço responde `GET /health` com `{ servico, status, dependencias }`. Pelo Kong: `/health/<servico>`, público (só estados: sem versão, host, mensagem de erro ou latência).
- `status`: `ok`; `degradado` (200) quando falta só dependência **não essencial** (cache fora, SMTP fora, circuito do banco de cartão aberto ou meio-aberto); `fora do ar` (503) quando falta dependência **essencial** (banco, Kafka).
- O health **nunca chama outro serviço** (nem o `/health` dele): se o catálogo cair, o health de `pedidos` continua `ok`, e o checkout é que devolve 503. Evita falha em cascata e dependência circular.
- Cada verificação tem limite de 2 s, todas em paralelo; resultados de Kafka e SMTP valem 5 s. O handler nunca lança.
- O formato `{ servico, status, dependencias }` é exceção documentada ao formato `{ erro }`.

**Logs**
- Toda linha de evento: `[servico] verbo tipo pedidoId=... correlationId=...` (verbos `publicou`, `recebeu`, `processou`, `compensou`, `ignorou`, `descartou`, `falhou`). Um `grep` pelo `X-Request-Id` mostra a compra inteira.
- Log HTTP `[servico] HTTP METODO caminho status Nms correlationId=...`, sem query string e **sem** `/health` (o Docker o chama a cada 10 s).
- Proibido em log: senha, JWT, cartão (só `cartaoFinal`), CPF, e-mail de cliente, corpo de requisição, mensagem crua de erro de banco ou SMTP.
- `X-Request-Id` só é aceito se casar com `^[A-Za-z0-9-]{1,64}$` (impede forjar linhas de log).

## Consequências
- Diagnóstico por serviço e por dependência; o Docker marca `unhealthy` quando o serviço está fora do ar.
- Health é amostragem: pode dizer `ok` e a próxima requisição falhar.
- Sem métricas nem traces (Prometheus, Grafana, Jaeger ficam fora do projeto): o `grep` por `correlationId` substitui um trace, com ordenação só por horário.
- Não logar e-mail dificulta achar o pedido de um cliente específico: busca-se pelo `pedidoId`.
