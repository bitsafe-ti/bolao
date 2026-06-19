# Atualizacao automatica de placares

O projeto usa o Worker `bolao-copa2026-results-sync` para consultar placares uma vez por minuto. O Worker compartilha o mesmo D1 do Cloudflare Pages e somente consulta a fonte externa quando existe jogo entre 30 minutos antes e 4 horas depois do horario marcado, ou quando um jogo esta com status `live`.

## Fontes

- Com `API_FOOTBALL_KEY`: usa API-Football para placar, minuto, status e gols.
- Sem a secret: usa automaticamente o JSON publico do OpenFootball como fallback. O fallback normalmente entrega apenas resultados finais.

## Configurar a API ao vivo

Cadastre a chave de forma interativa. Nao coloque a chave no `wrangler.jsonc`, em `.env` versionado ou na linha de comando.

```bash
npx wrangler secret put API_FOOTBALL_KEY --config workers/live-results/wrangler.jsonc
```

As configuracoes nao secretas ficam em `workers/live-results/wrangler.jsonc`:

- `API_FOOTBALL_LEAGUE_ID`: identificador da Copa do Mundo.
- `API_FOOTBALL_SEASON`: temporada consultada.
- `POOL_ID`: bolao atualizado no D1.

Confirme esses identificadores no painel da API antes do inicio do campeonato, pois a cobertura do provedor pode mudar.

## Deploy

```bash
npm run deploy:results-worker
```

O deploy completo publica primeiro o Pages e depois o Worker:

```bash
npm run deploy:cloudflare
```

## Validacao

Validar o bundle sem publicar:

```bash
npx wrangler deploy --config workers/live-results/wrangler.jsonc --dry-run
```

Testar o gatilho localmente:

```bash
npx wrangler dev --config workers/live-results/wrangler.jsonc --test-scheduled
```

Em outro terminal, acione `http://localhost:8787/__scheduled`.

No desenvolvimento local, o endpoint `/health` informa se o Worker esta ativo e se o provedor ao vivo esta configurado, sem expor a chave. Em producao, o Worker nao possui rota publica e executa somente pelo cron.
