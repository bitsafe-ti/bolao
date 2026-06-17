# Cloudflare D1

## Setup

1. Install dependencies:

```bash
npm install
```

2. Login to Cloudflare:

```bash
npx wrangler login
```

3. Create the D1 database:

```bash
npx wrangler d1 create bolao-copa2026
```

4. Copy the generated `database_id` into `wrangler.toml`.

5. Apply the schema:

```bash
npx wrangler d1 migrations apply bolao-copa2026 --remote
```

6. Import the current Appwrite JSON export:

```bash
node scripts/import-pool-state-to-d1.mjs "C:\Users\guilh\OneDrive\Desktop\{users[{iduser-mqb267g4-464qmr,name.txt" copa-2026 --remote
```

7. Deploy:

```bash
npm run deploy:cloudflare
```

## Local Development

Run the D1 migration locally:

```bash
npx wrangler d1 migrations apply bolao-copa2026 --local
node scripts/import-pool-state-to-d1.mjs "C:\Users\guilh\OneDrive\Desktop\{users[{iduser-mqb267g4-464qmr,name.txt" copa-2026 --local
```

Then start Pages locally:

```bash
npm run pages:dev
```
