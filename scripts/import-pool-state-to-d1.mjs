import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const [, , inputPath, poolId = "copa-2026", mode = "--local"] = process.argv;

if (!inputPath) {
  console.error("Usage: node scripts/import-pool-state-to-d1.mjs <state-json-file> [poolId] [--local|--remote]");
  process.exit(1);
}

const resolvedInput = path.resolve(inputPath);
const raw = fs.readFileSync(resolvedInput, "utf8");
const data = JSON.parse(raw);
const now = new Date().toISOString();
const sql = `
insert into pool_state (id, data, created_at, updated_at)
values ('${escapeSql(poolId)}', '${escapeSql(JSON.stringify(data))}', '${now}', '${now}')
on conflict(id) do update set
  data = excluded.data,
  updated_at = excluded.updated_at;
`;

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bolao-d1-"));
const tmpSql = path.join(tmpDir, "import-pool-state.sql");
fs.writeFileSync(tmpSql, sql, "utf8");

const wranglerBin = path.join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");
const args = [wranglerBin, "d1", "execute", "bolao-copa2026", mode];
if (mode === "--local") args.push("--persist-to", ".wrangler/state");
args.push("--file", tmpSql);
const command = process.execPath;
const result = spawnSync(command, args, { stdio: "inherit" });
fs.rmSync(tmpDir, { force: true, recursive: true });

process.exit(result.status ?? 1);

function escapeSql(value) {
  return String(value).replaceAll("'", "''");
}
