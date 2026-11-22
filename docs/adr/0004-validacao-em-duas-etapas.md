# ADR 0004: Validação em duas etapas

Status: aceita (aula 06)

## Contexto
Validar só na aplicação deixa passar o que escapa dela (script, corrida entre duas requisições, bug). Validar só no banco devolve ao cliente erros técnicos e pouco úteis.

## Decisão
- Primeira etapa: schemas Zod na entrada de cada rota, com mensagens em português, uma por regra (viram `detalhes` na resposta).
- Segunda etapa: o banco como última linha de defesa (`UNIQUE` em `email`, `sku` e `slug`, `NOT NULL`, `CHECK`). Violação vira 409, nunca uma mensagem crua do banco.

## Consequências
- Entrada inválida volta com erro claro e antes de tocar no banco; duplicidade concorrente é barrada mesmo que a aplicação perca a corrida.
- A mesma regra existe em dois lugares e precisa ser mantida coerente (Zod e índice/constraint).
