# ADR 0009: Resiliência na chamada ao banco externo e banco-falso fora do Kong

Status: aceita (aula 09)

## Contexto
O banco do cartão não é nosso: demora, cai e recusa. Lento é pior que fora do ar, porque requisições presas esgotam recursos e derrubam os vizinhos.

## Decisão
Em `pagamentos → banco` (e só ali, a camada mais próxima de quem falha):
- **Timeout** de 2 s em toda chamada.
- **Retry** de até 3 tentativas, esperando 500 ms e 1 s (+ jitter), só para timeout, erro de rede e 5xx. 402 é resposta, não se repete.
- **Idempotência**: `referencia` = id do pedido; o banco reconhece e não cobra duas vezes.
- **Circuit breaker** com `opossum`: abre com 50% de falha em pelo menos 5 chamadas; meio-aberto depois de 15 s.
- Timeout sem resposta → estorno "por segurança" da referência.
- Estorno fora do circuit breaker (devolver dinheiro não pode ser barrado).
- **Fallback**: falhar rápido: pagamento `ERRO` → `pagamento.recusado` → pedido cancelado.
- O estado do circuito aparece no `/health` (ADR 0010).
- O `banco-falso` simula o sistema externo (sem banco de dados; latência e falhas por `POST /config`) e publica a porta **9000** fora do Kong: ninguém deveria chamar o banco pela loja.

## Consequências
- A cobrança pode levar ~7,5 s no pior caso (3 timeouts + esperas), sem ninguém esperando, porque é por evento.
- Um circuito por réplica (estado em memória, não compartilhado).
- Banco fora cancela o pedido em vez de esperar: decisão de negócio mais simples. Deixar o pedido esperando o banco voltar fica como alternativa (cancelar ou esperar).
- A porta 9000 sem autenticação é outra exceção à regra "só o gateway publica portas".
