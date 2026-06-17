const EMPTY_STATE = {
  users: [],
  participants: [],
  predictions: {},
  auditLogs: [],
  matches: [],
  lastResultSyncAt: "",
  releasedPredictionRound: 1,
  deletedUserIds: [],
  deletedParticipantIds: []
};

function mergeAuditLogs(currentLogs, incomingLogs) {
  const logsById = new Map();
  for (const log of [...(currentLogs ?? []), ...(incomingLogs ?? [])]) {
    if (!log?.id) continue;
    logsById.set(log.id, log);
  }
  return [...logsById.values()]
    .sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""))
    .slice(0, 1000);
}

class LockedResultError extends Error {
  constructor(message) {
    super(message);
    this.name = "LockedResultError";
  }
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(init.headers ?? {})
    }
  });
}

function getDb(context) {
  const db = context.env.DB;
  if (!db) {
    throw new Error("Binding D1 DB nao configurado.");
  }
  return db;
}

async function readPoolState(db, poolId) {
  await ensureSchema(db);
  const row = await db
    .prepare("select data from pool_state where id = ?")
    .bind(poolId)
    .first();

  if (!row?.data) return { ...EMPTY_STATE };
  return { ...EMPTY_STATE, ...JSON.parse(row.data) };
}

function parseScore(value) {
  if (value === "" || value === null || value === undefined) return null;
  const score = Number(value);
  return Number.isInteger(score) && score >= 0 ? String(score) : null;
}

function getLockedScore(match) {
  const home = parseScore(match?.homeScore);
  const away = parseScore(match?.awayScore);
  if (home === null || away === null) return null;
  return { home, away };
}

function assertLockedResultsAreUnchanged(currentState, nextState) {
  const nextMatchesById = new Map((nextState.matches ?? []).map((match) => [match.id, match]));

  for (const currentMatch of currentState.matches ?? []) {
    const lockedScore = getLockedScore(currentMatch);
    if (!lockedScore) continue;

    const nextMatch = nextMatchesById.get(currentMatch.id);
    const nextScore = getLockedScore(nextMatch);
    const changed =
      !nextScore ||
      nextScore.home !== lockedScore.home ||
      nextScore.away !== lockedScore.away;

    if (changed) {
      throw new LockedResultError(
        `Resultado bloqueado para ${currentMatch.id}: ${lockedScore.home} x ${lockedScore.away}.`
      );
    }
  }
}

async function ensureSchema(db) {
  await db
    .prepare(`
      create table if not exists pool_state (
        id text primary key,
        data text not null,
        created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `)
    .run();
}

export async function onRequestGet(context) {
  try {
    const poolId = context.params.poolId || "copa-2026";
    const state = await readPoolState(getDb(context), poolId);
    return jsonResponse(state);
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
}

export async function onRequestPut(context) {
  try {
    const poolId = context.params.poolId || "copa-2026";
    const body = await context.request.json();
    const nextState = { ...EMPTY_STATE, ...body };
    const now = new Date().toISOString();
    const db = getDb(context);

    await ensureSchema(db);
    const currentState = await readPoolState(db, poolId);
    assertLockedResultsAreUnchanged(currentState, nextState);

    // Server-side merge of critical fields to prevent lost updates from concurrent writes.
    // The D1 read above and the write below are serialized by SQLite, so merging here is
    // safe against race conditions that the client-side merge cannot fully prevent.
    const finalState = {
      ...nextState,
      releasedPredictionRound: Math.max(
        Number(currentState.releasedPredictionRound) || 1,
        Number(nextState.releasedPredictionRound) || 1
      ),
      auditLogs: mergeAuditLogs(currentState.auditLogs, nextState.auditLogs)
    };

    const data = JSON.stringify(finalState);
    await db
      .prepare(`
        insert into pool_state (id, data, created_at, updated_at)
        values (?, ?, ?, ?)
        on conflict(id) do update set
          data = excluded.data,
          updated_at = excluded.updated_at
      `)
      .bind(poolId, data, now, now)
      .run();

    return jsonResponse(JSON.parse(data));
  } catch (error) {
    if (error instanceof LockedResultError) {
      return jsonResponse({ error: error.message }, { status: 409 });
    }
    return jsonResponse({ error: error.message }, { status: 500 });
  }
}

export async function onRequestPatch(context) {
  return onRequestPut(context);
}
