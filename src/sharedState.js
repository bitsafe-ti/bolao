const viteEnv = import.meta.env ?? {};

const DOCUMENT_ID = viteEnv.VITE_POOL_ID || "copa-2026";
const API_BASE_URL = (viteEnv.VITE_API_BASE_URL || "").replace(/\/$/, "");

const EMPTY_STATE = {
  users: [],
  participants: [],
  predictions: {},
  payments: {},
  paymentEvents: [],
  auditLogs: [],
  notifications: [],
  matches: [],
  lastResultSyncAt: "",
  lastResultSyncSource: "",
  releasedPredictionRound: 1,
  deletedUserIds: [],
  deletedParticipantIds: []
};

function stripSensitiveParticipantData(participant = {}) {
  const { prizePayout: _prizePayout, ...safeParticipant } = participant;
  return safeParticipant;
}

function getPoolStateUrl(documentId = DOCUMENT_ID) {
  return `${API_BASE_URL}/api/pool-state/${encodeURIComponent(documentId)}`;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    }
  });

  if (!response.ok) {
    let message = response.statusText || "Erro desconhecido";
    try {
      const payload = await response.json();
      message = payload.error || payload.message || message;
    } catch {}
    throw new Error(message);
  }

  return response.json();
}

export function getPublicPoolState(state) {
  return {
    users: state.users ?? [],
    participants: (state.participants ?? []).map(stripSensitiveParticipantData),
    predictions: state.predictions ?? {},
    payments: state.payments ?? {},
    paymentEvents: state.paymentEvents ?? [],
    auditLogs: state.auditLogs ?? [],
    notifications: state.notifications ?? [],
    matches: state.matches ?? [],
    lastResultSyncAt: state.lastResultSyncAt ?? "",
    lastResultSyncSource: state.lastResultSyncSource ?? "",
    releasedPredictionRound: Number(state.releasedPredictionRound) || 1,
    deletedUserIds: state.deletedUserIds ?? [],
    deletedParticipantIds: state.deletedParticipantIds ?? []
  };
}

function getTimestamp(item = {}) {
  return Math.max(
    ...[item.updatedAt, item.resultUpdatedAt, item.createdAt].map((value) => {
      const time = Date.parse(value || "");
      return Number.isNaN(time) ? 0 : time;
    })
  );
}

function pickNewest(currentItem, sharedItem, prefer = "shared") {
  if (!currentItem) return sharedItem;
  if (!sharedItem) return currentItem;
  const currentTime = getTimestamp(currentItem);
  const sharedTime = getTimestamp(sharedItem);
  if (currentTime > sharedTime) return currentItem;
  if (sharedTime > currentTime) return sharedItem;
  return prefer === "current" ? currentItem : sharedItem;
}

function mergeById(currentItems = [], sharedItems = [], prefer = "shared") {
  const ids = new Set([...currentItems.map((item) => item.id), ...sharedItems.map((item) => item.id)]);
  const currentById = Object.fromEntries(currentItems.map((item) => [item.id, item]));
  const sharedById = Object.fromEntries(sharedItems.map((item) => [item.id, item]));
  return [...ids].map((id) => pickNewest(currentById[id], sharedById[id], prefer)).filter(Boolean);
}

function mergePredictionMaps(currentPredictions = {}, sharedPredictions = {}, prefer = "shared") {
  const participantIds = new Set([...Object.keys(currentPredictions), ...Object.keys(sharedPredictions)]);
  const merged = {};
  for (const participantId of participantIds) {
    const currentMatches = currentPredictions[participantId] ?? {};
    const sharedMatches = sharedPredictions[participantId] ?? {};
    const matchIds = new Set([...Object.keys(currentMatches), ...Object.keys(sharedMatches)]);
    merged[participantId] = {};
    for (const matchId of matchIds) {
      merged[participantId][matchId] = pickNewest(currentMatches[matchId], sharedMatches[matchId], prefer);
    }
  }
  return merged;
}

function mergePaymentMaps(currentPayments = {}, sharedPayments = {}, prefer = "shared") {
  const participantIds = new Set([...Object.keys(currentPayments), ...Object.keys(sharedPayments)]);
  return Object.fromEntries(
    [...participantIds]
      .map((participantId) => [participantId, pickNewest(currentPayments[participantId], sharedPayments[participantId], prefer)])
      .filter(([, payment]) => Boolean(payment))
  );
}

function mergeDeletedIds(currentIds = [], sharedIds = []) {
  return [...new Set([...(currentIds ?? []), ...(sharedIds ?? [])].filter(Boolean))];
}

function mergeAuditLogs(currentLogs = [], sharedLogs = []) {
  const logsById = new Map();
  for (const log of [...(currentLogs ?? []), ...(sharedLogs ?? [])]) {
    if (!log?.id) continue;
    logsById.set(log.id, log);
  }
  return [...logsById.values()]
    .sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""))
    .slice(0, 1000);
}

function deduplicateEmails(users, participants, predictions) {
  const sortedUsers = [...users].sort((a, b) => {
    const ta = Date.parse(a.createdAt || a.updatedAt || "");
    const tb = Date.parse(b.createdAt || b.updatedAt || "");
    return (Number.isNaN(ta) ? Infinity : ta) - (Number.isNaN(tb) ? Infinity : tb);
  });
  const usersByEmail = new Map();
  for (const user of sortedUsers) {
    const key = (user.email || "").toLowerCase();
    if (key && !usersByEmail.has(key)) usersByEmail.set(key, user);
  }
  const cleanUsers = [...usersByEmail.values()];

  const canonicalParticipantIdByEmail = new Map();
  for (const user of cleanUsers) {
    if (user.participantId && user.email) {
      canonicalParticipantIdByEmail.set(user.email.toLowerCase(), user.participantId);
    }
  }

  const participantsByEmail = new Map();
  for (const participant of participants) {
    const key = (participant.email || "").toLowerCase();
    if (!key) continue;
    if (!participantsByEmail.has(key)) participantsByEmail.set(key, []);
    participantsByEmail.get(key).push(participant);
  }

  const cleanParticipants = [];
  const participantIdRemap = new Map();

  for (const [email, group] of participantsByEmail) {
    const canonicalId = canonicalParticipantIdByEmail.get(email);
    let canonical = group.find((participant) => participant.id === canonicalId);
    if (!canonical) {
      canonical = [...group].sort((a, b) => {
        const ta = Date.parse(a.createdAt || a.updatedAt || "");
        const tb = Date.parse(b.createdAt || b.updatedAt || "");
        return (Number.isNaN(ta) ? Infinity : ta) - (Number.isNaN(tb) ? Infinity : tb);
      })[0];
    }
    cleanParticipants.push(canonical);
    for (const participant of group) {
      if (participant.id !== canonical.id) participantIdRemap.set(participant.id, canonical.id);
    }
  }

  for (const participant of participants) {
    if (!(participant.email || "").toLowerCase()) cleanParticipants.push(participant);
  }

  if (participantIdRemap.size === 0) {
    return { users: cleanUsers, participants: cleanParticipants, predictions };
  }

  const newPredictions = {};
  for (const [participantId, perMatch] of Object.entries(predictions ?? {})) {
    const canonicalId = participantIdRemap.get(participantId) ?? participantId;
    if (!newPredictions[canonicalId]) newPredictions[canonicalId] = {};
    for (const [matchId, prediction] of Object.entries(perMatch ?? {})) {
      newPredictions[canonicalId][matchId] = pickNewest(newPredictions[canonicalId][matchId], prediction);
    }
  }

  return { users: cleanUsers, participants: cleanParticipants, predictions: newPredictions };
}

function filterDeleted(state) {
  const deletedUserIds = new Set(state.deletedUserIds ?? []);
  const deletedParticipantIds = new Set(state.deletedParticipantIds ?? []);
  const predictions = Object.fromEntries(
    Object.entries(state.predictions ?? {}).filter(([participantId]) => !deletedParticipantIds.has(participantId))
  );
  const payments = Object.fromEntries(
    Object.entries(state.payments ?? {}).filter(([participantId]) => !deletedParticipantIds.has(participantId))
  );
  return {
    ...state,
    users: (state.users ?? []).filter(
      (user) => !deletedUserIds.has(user.id) && !deletedParticipantIds.has(user.participantId)
    ),
    participants: (state.participants ?? []).filter((participant) => !deletedParticipantIds.has(participant.id)),
    predictions,
    payments,
    deletedUserIds: [...deletedUserIds],
    deletedParticipantIds: [...deletedParticipantIds]
  };
}

export function mergePublicPoolState(current, shared = {}, options = {}) {
  const prefer = options.prefer ?? "shared";
  const deletedUserIds = mergeDeletedIds(current.deletedUserIds, shared.deletedUserIds);
  const deletedParticipantIds = mergeDeletedIds(current.deletedParticipantIds, shared.deletedParticipantIds);

  const matchesById = new Map();
  for (const match of mergeById(current.matches ?? [], shared.matches ?? [], prefer)) {
    const baseMatch = (current.matches ?? []).find((item) => item.id === match.id) ?? {};
    matchesById.set(match.id, { ...baseMatch, ...match });
  }

  const currentSyncTime = Date.parse(current.lastResultSyncAt || "");
  const sharedSyncTime = Date.parse(shared.lastResultSyncAt || "");

  const { users, participants, predictions } = deduplicateEmails(
    mergeById(current.users ?? [], shared.users ?? [], prefer),
    mergeById(current.participants ?? [], shared.participants ?? [], prefer),
    mergePredictionMaps(current.predictions ?? {}, shared.predictions ?? {}, prefer)
  );

  return filterDeleted({
    ...current,
    deletedUserIds,
    deletedParticipantIds,
    users,
    participants,
    predictions,
    payments: mergePaymentMaps(current.payments ?? {}, shared.payments ?? {}, prefer),
    paymentEvents: mergeById(current.paymentEvents ?? [], shared.paymentEvents ?? [], prefer).slice(0, 300),
    auditLogs: mergeAuditLogs(current.auditLogs, shared.auditLogs),
    notifications: mergeById(current.notifications ?? [], shared.notifications ?? [], prefer),
    matches: [...matchesById.values()],
    releasedPredictionRound: Math.max(
      Number(current.releasedPredictionRound) || 1,
      Number(shared.releasedPredictionRound) || 1
    ),
    lastResultSyncAt:
      (Number.isNaN(sharedSyncTime) ? 0 : sharedSyncTime) > (Number.isNaN(currentSyncTime) ? 0 : currentSyncTime)
        ? shared.lastResultSyncAt
        : current.lastResultSyncAt,
    lastResultSyncSource:
      (Number.isNaN(sharedSyncTime) ? 0 : sharedSyncTime) > (Number.isNaN(currentSyncTime) ? 0 : currentSyncTime)
        ? shared.lastResultSyncSource
        : current.lastResultSyncSource
  });
}

async function fetchPoolStateByDocumentId(documentId) {
  try {
    const state = await requestJson(getPoolStateUrl(documentId));
    return { ...EMPTY_STATE, ...state };
  } catch (error) {
    throw new Error(`Banco indisponivel: ${error.message}`);
  }
}

export async function fetchPoolState() {
  return fetchPoolStateByDocumentId(DOCUMENT_ID);
}

export async function fetchPoolStateFromPool(poolId) {
  return fetchPoolStateByDocumentId(poolId);
}

export async function persistPoolState(nextState) {
  const remote = await fetchPoolState();

  const deletedUserIds = [
    ...new Set([...(nextState.deletedUserIds ?? []), ...(remote.deletedUserIds ?? [])])
  ];
  const deletedParticipantIds = [
    ...new Set([...(nextState.deletedParticipantIds ?? []), ...(remote.deletedParticipantIds ?? [])])
  ];
  const effectiveNext = { ...nextState, deletedUserIds, deletedParticipantIds };
  const merged = mergePublicPoolState(effectiveNext, remote, { prefer: "current" });

  const deletedUserSet = new Set(deletedUserIds);
  const deletedParticipantSet = new Set(deletedParticipantIds);
  const payload = getPublicPoolState({
    ...merged,
    users: (merged.users ?? []).filter(
      (user) => !deletedUserSet.has(user.id) && !deletedParticipantSet.has(user.participantId)
    ),
    participants: (merged.participants ?? []).filter((participant) => !deletedParticipantSet.has(participant.id)),
    predictions: Object.fromEntries(
      Object.entries(merged.predictions ?? {}).filter(([participantId]) => !deletedParticipantSet.has(participantId))
    ),
    payments: Object.fromEntries(
      Object.entries(merged.payments ?? {}).filter(([participantId]) => !deletedParticipantSet.has(participantId))
    ),
    deletedUserIds,
    deletedParticipantIds
  });

  return requestJson(getPoolStateUrl(DOCUMENT_ID), {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function subscribeToPoolChanges() {
  return () => {};
}

export function unsubscribeFromPoolChanges(unsubscribeFn) {
  if (typeof unsubscribeFn === "function") unsubscribeFn();
}
