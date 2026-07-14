const EMPTY_STATE = {
  users: [],
  participants: [],
  predictions: {},
  payments: {},
  paymentEvents: [],
  prizePayouts: {},
  auditLogs: [],
  matches: [],
  lastResultSyncAt: "",
  lastResultSyncSource: "",
  releasedPredictionRound: 1,
  deletedUserIds: [],
  deletedParticipantIds: []
};
const MAX_WRITE_ATTEMPTS = 3;

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

function getTimestamp(item = {}) {
  return Math.max(
    ...[item.updatedAt, item.confirmedAt, item.createdAt].map((value) => {
      const time = Date.parse(value || "");
      return Number.isNaN(time) ? 0 : time;
    })
  );
}

function pickNewest(currentItem, incomingItem) {
  if (!currentItem) return incomingItem;
  if (!incomingItem) return currentItem;
  return getTimestamp(incomingItem) >= getTimestamp(currentItem) ? incomingItem : currentItem;
}

function mergePaymentMaps(currentPayments = {}, incomingPayments = {}) {
  const participantIds = new Set([...Object.keys(currentPayments ?? {}), ...Object.keys(incomingPayments ?? {})]);
  return Object.fromEntries(
    [...participantIds]
      .map((participantId) => [participantId, pickNewest(currentPayments?.[participantId], incomingPayments?.[participantId])])
      .filter(([, payment]) => Boolean(payment))
  );
}

function mergePaymentEvents(currentEvents = [], incomingEvents = []) {
  const eventsById = new Map();
  for (const event of [...(currentEvents ?? []), ...(incomingEvents ?? [])]) {
    if (!event?.id) continue;
    eventsById.set(event.id, event);
  }
  return [...eventsById.values()]
    .sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""))
    .slice(0, 300);
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

function stripSensitiveParticipantData(participant = {}) {
  const { prizePayout: _prizePayout, ...safeParticipant } = participant;
  return safeParticipant;
}

function getPublicState(state = {}) {
  const { prizePayouts: _prizePayouts, ...safeState } = state;
  return {
    ...safeState,
    participants: (safeState.participants ?? []).map(stripSensitiveParticipantData)
  };
}

function getDb(context) {
  const db = context.env.DB;
  if (!db) {
    throw new Error("Binding D1 DB nao configurado.");
  }
  return db;
}

async function readPoolStateRecord(db, poolId) {
  await ensureSchema(db);
  const row = await db
    .prepare("select data, updated_at from pool_state where id = ?")
    .bind(poolId)
    .first();

  if (!row?.data) return { state: { ...EMPTY_STATE }, version: null };
  return { state: { ...EMPTY_STATE, ...JSON.parse(row.data) }, version: row.updated_at };
}

async function readPoolState(db, poolId) {
  return (await readPoolStateRecord(db, poolId)).state;
}

function parseScore(value) {
  if (value === "" || value === null || value === undefined) return null;
  const score = Number(value);
  return Number.isInteger(score) && score >= 0 ? String(score) : null;
}

function getStoredScore(match) {
  const home = parseScore(match?.homeScore);
  const away = parseScore(match?.awayScore);
  if (home === null || away === null) return null;
  return { home, away };
}

function isFinishedResult(match) {
  if (!getStoredScore(match)) return false;
  const status = String(match?.status || match?.statusShort || "").toLowerCase();
  if (!status) return true;
  return ["finished", "ft", "aet", "pen", "awd", "wo"].includes(status);
}

function getResultTimestamp(match) {
  const time = Date.parse(match?.resultUpdatedAt || "");
  return Number.isNaN(time) ? 0 : time;
}

const RESULT_FIELDS = [
  "homeScore",
  "awayScore",
  "homeGoals",
  "awayGoals",
  "goesToExtraTime",
  "goesToPenalties",
  "qualifiedSide",
  "penaltiesHome",
  "penaltiesAway",
  "status",
  "statusShort",
  "elapsed",
  "resultSource",
  "sourceFixtureId",
  "resultUpdatedAt"
];

function preserveResultFields(target, source) {
  const merged = { ...target };
  for (const field of RESULT_FIELDS) {
    if (hasMeaningfulResultValue(source[field])) merged[field] = source[field];
  }
  return merged;
}

function hasMeaningfulResultValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value === true;
  return value !== undefined && value !== null && value !== "";
}

export function mergeMatchesPreservingResults(currentMatches = [], nextMatches = []) {
  const currentById = new Map(currentMatches.map((match) => [match.id, match]));
  const nextById = new Map(nextMatches.map((match) => [match.id, match]));
  const ids = new Set([...currentById.keys(), ...nextById.keys()]);

  return [...ids].map((id) => {
    const current = currentById.get(id);
    const next = nextById.get(id);
    if (!current) return next;
    if (!next) return current;

    const keepCurrentResult =
      isFinishedResult(current) || getResultTimestamp(current) > getResultTimestamp(next);
    return keepCurrentResult ? preserveResultFields(next, current) : next;
  }).filter(Boolean);
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
    return jsonResponse(getPublicState(state), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
}

export async function onRequestPut(context) {
  try {
    const poolId = context.params.poolId || "copa-2026";
    const body = await context.request.json();
    const nextState = getPublicState({ ...EMPTY_STATE, ...body });
    const db = getDb(context);

    await ensureSchema(db);
    for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
      const snapshot = await readPoolStateRecord(db, poolId);
      const currentState = snapshot.state;
      const currentSyncTime = Date.parse(currentState.lastResultSyncAt || "");
      const nextSyncTime = Date.parse(nextState.lastResultSyncAt || "");
      const keepCurrentSync =
        (Number.isNaN(nextSyncTime) ? 0 : nextSyncTime) < (Number.isNaN(currentSyncTime) ? 0 : currentSyncTime);
      const finalState = {
        ...nextState,
        matches: mergeMatchesPreservingResults(currentState.matches, nextState.matches),
        lastResultSyncAt: keepCurrentSync
          ? currentState.lastResultSyncAt
          : nextState.lastResultSyncAt,
        lastResultSyncSource: keepCurrentSync
          ? currentState.lastResultSyncSource
          : nextState.lastResultSyncSource,
        releasedPredictionRound: Math.max(
          Number(currentState.releasedPredictionRound) || 1,
          Number(nextState.releasedPredictionRound) || 1
        ),
        payments: mergePaymentMaps(currentState.payments, nextState.payments),
        paymentEvents: mergePaymentEvents(currentState.paymentEvents, nextState.paymentEvents),
        prizePayouts: currentState.prizePayouts ?? {},
        auditLogs: mergeAuditLogs(currentState.auditLogs, nextState.auditLogs)
      };
      const now = new Date().toISOString();
      const data = JSON.stringify(finalState);
      const write = await db.prepare(`
        insert into pool_state (id, data, created_at, updated_at)
        values (?, ?, ?, ?)
        on conflict(id) do update set
          data = excluded.data,
          updated_at = excluded.updated_at
        where pool_state.updated_at = ?
      `).bind(poolId, data, now, now, snapshot.version).run();

      if ((write.meta?.changes ?? 0) > 0) return jsonResponse(getPublicState(finalState));
    }

    throw new Error("Nao foi possivel salvar devido a atualizacoes concorrentes.");
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
}

export async function onRequestPatch(context) {
  return onRequestPut(context);
}
