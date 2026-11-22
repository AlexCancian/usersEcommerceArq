# Plano frontend: observabilidade-cache
Data: 22/11/2026

N/A — sem frontend; validação via `requests/*.http` e `http/fluxo-completo.http`.

- `http/fluxo-completo.http`: fluxo de ponta a ponta (contrato §6.1).
- `requests/observabilidade.http`: health de todos os serviços e cache MISS/HIT/OFF (contrato §6.2).
- Paralelizável com backend: não se aplica (perfil `aulas-ecommerce`, sem dev-frontend).
