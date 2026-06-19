import { applyResultUpdates } from "../../src/resultsSync.js";
import { fetchResultSource } from "./provider.js";

const SYNC_BEFORE_KICKOFF_MS = 30 * 60 * 1000;
const SYNC_AFTER_KICKOFF_MS = 4 * 60 * 60 * 1000;
const MAX_WRITE_ATTEMPTS = 3;

function isFinished(match) {
  const status = String(match?.status || match?.statusShort || "").toLowerCase();
  return ["finished", "ft", "aet", "pen", "awd", "wo"].includes(status);
}

function parseSaoPauloKickoff(value) {
  if (!value) return Number.NaN;
  const text = String(value);
  const hasTimeZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
  if (hasTimeZone) return Date.parse(text);
  return Date.parse(`${text.length === 16 ? `${text}:00` : text}-03:00`);
}

export function shouldSyncLiveResults(matches, now = new Date()) {
  const nowTime = now.getTime();
  return (matches ?? []).some((match) => {
    if (isFinished(match) || ["cancelled", "postponed"].includes(match?.status)) return false;
    if (match?.status === "live") return true;
    const kickoff = parseSaoPauloKickoff(match?.date);
    if (Number.isNaN(kickoff)) return false;
    return nowTime >= kickoff - SYNC_BEFORE_KICKOFF_MS && nowTime <= kickoff + SYNC_AFTER_KICKOFF_MS;
  });
}

async function ensureSchema(db) {
  await db.prepare(`
    create table if not exists pool_state (
      id text primary key,
      data text not null,
      created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `).run();
}

async function readPoolState(db, poolId) {
  await ensureSchema(db);
  const row = await db.prepare("select data, updated_at from pool_state where id = ?").bind(poolId).first();
  if (!row?.data) return null;
  return { state: JSON.parse(row.data), version: row.updated_at };
}

function appendSyncAudit(state, changed, source, now) {
  if (!changed) return state.auditLogs ?? [];
  const entry = {
    id: `audit-results-${crypto.randomUUID()}`,
    createdAt: now,
    actor: "Sistema",
    action: "results_synced",
    details: `${changed} jogo${changed === 1 ? "" : "s"} atualizado${changed === 1 ? "" : "s"} via ${source}`
  };
  return [entry, ...(state.auditLogs ?? [])].slice(0, 1000);
}

async function writePoolState(db, poolId, version, state, now) {
  return db.prepare(`
    update pool_state
    set data = ?, updated_at = ?
    where id = ? and updated_at = ?
  `).bind(JSON.stringify(state), now, poolId, version).run();
}

export async function syncPoolResults(env, scheduledTime = Date.now(), options = {}) {
  const poolId = env.POOL_ID || "copa-2026";
  const now = new Date(scheduledTime);
  let source;

  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
    const snapshot = await readPoolState(env.DB, poolId);
    if (!snapshot) return { status: "empty", changed: 0, source: "none" };
    if (!options.force && !shouldSyncLiveResults(snapshot.state.matches, now)) {
      return { status: "outside-window", changed: 0, source: "none" };
    }

    source ??= await fetchResultSource(env, now);
    const update = applyResultUpdates(snapshot.state.matches ?? [], source.matches);
    const syncedAt = new Date().toISOString();
    const nextState = {
      ...snapshot.state,
      matches: update.matches,
      auditLogs: appendSyncAudit(snapshot.state, update.changed, source.source, syncedAt),
      lastResultSyncAt: syncedAt,
      lastResultSyncSource: source.source
    };
    const write = await writePoolState(env.DB, poolId, snapshot.version, nextState, syncedAt);
    if ((write.meta?.changes ?? 0) > 0) {
      return { status: "synced", changed: update.changed, source: source.source };
    }
  }

  throw new Error("Nao foi possivel salvar os placares devido a atualizacoes concorrentes.");
}
