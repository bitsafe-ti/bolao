import { Client, Databases, Permission, Role } from "appwrite";

const viteEnv = import.meta.env ?? {};

const ENDPOINT    = viteEnv.VITE_APPWRITE_ENDPOINT    || "https://nyc.cloud.appwrite.io/v1";
const PROJECT_ID  = viteEnv.VITE_APPWRITE_PROJECT_ID  || "6a2c61c200150745bf42";
const DATABASE_ID = viteEnv.VITE_APPWRITE_DATABASE_ID || "bolao";
const COLLECTION_ID = viteEnv.VITE_APPWRITE_COLLECTION_ID || "pool_state";
const DOCUMENT_ID = viteEnv.VITE_POOL_ID              || "copa-2026";

const client = new Client().setEndpoint(ENDPOINT).setProject(PROJECT_ID);
const databases = new Databases(client);

const EMPTY_STATE = {
  users: [],
  participants: [],
  predictions: {},
  matches: [],
  lastResultSyncAt: "",
  deletedUserIds: [],
  deletedParticipantIds: []
};

export function getPublicPoolState(state) {
  return {
    users: state.users ?? [],
    participants: state.participants ?? [],
    predictions: state.predictions ?? {},
    matches: state.matches ?? [],
    lastResultSyncAt: state.lastResultSyncAt ?? "",
    deletedUserIds: state.deletedUserIds ?? [],
    deletedParticipantIds: state.deletedParticipantIds ?? []
  };
}

function getTimestamp(item = {}) {
  const value = item.updatedAt || item.resultUpdatedAt || item.createdAt || "";
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
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

function mergeDeletedIds(currentIds = [], sharedIds = []) {
  return [...new Set([...(currentIds ?? []), ...(sharedIds ?? [])].filter(Boolean))];
}

// Collapse duplicate users/participants that share the same email.
// Keeps the oldest registration; migrates predictions from removed participant IDs
// to the canonical one so no score data is lost.
function deduplicateEmails(users, participants, predictions) {
  // 1. Deduplicate users by email — keep oldest (lowest createdAt)
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

  // 2. Determine canonical participantId per email (what the kept user points to)
  const canonicalParticipantIdByEmail = new Map();
  for (const user of cleanUsers) {
    if (user.participantId && user.email) {
      canonicalParticipantIdByEmail.set(user.email.toLowerCase(), user.participantId);
    }
  }

  // 3. Deduplicate participants by email — prefer the one linked to the kept user
  const participantsByEmail = new Map();
  for (const p of participants) {
    const key = (p.email || "").toLowerCase();
    if (!key) continue;
    if (!participantsByEmail.has(key)) participantsByEmail.set(key, []);
    participantsByEmail.get(key).push(p);
  }

  const cleanParticipants = [];
  const participantIdRemap = new Map(); // discarded id → canonical id

  for (const [email, group] of participantsByEmail) {
    const canonicalId = canonicalParticipantIdByEmail.get(email);
    let canonical = group.find((p) => p.id === canonicalId);
    if (!canonical) {
      // No user link — keep oldest
      canonical = [...group].sort((a, b) => {
        const ta = Date.parse(a.createdAt || a.updatedAt || "");
        const tb = Date.parse(b.createdAt || b.updatedAt || "");
        return (Number.isNaN(ta) ? Infinity : ta) - (Number.isNaN(tb) ? Infinity : tb);
      })[0];
    }
    cleanParticipants.push(canonical);
    for (const p of group) {
      if (p.id !== canonical.id) participantIdRemap.set(p.id, canonical.id);
    }
  }
  // Keep participants without an email as-is (no dedup possible)
  for (const p of participants) {
    if (!(p.email || "").toLowerCase()) cleanParticipants.push(p);
  }

  if (participantIdRemap.size === 0) {
    return { users: cleanUsers, participants: cleanParticipants, predictions };
  }

  // 4. Migrate predictions from discarded participant IDs to canonical IDs
  const newPredictions = {};
  for (const [participantId, perMatch] of Object.entries(predictions ?? {})) {
    const canonicalId = participantIdRemap.get(participantId) ?? participantId;
    if (!newPredictions[canonicalId]) newPredictions[canonicalId] = {};
    for (const [matchId, pred] of Object.entries(perMatch ?? {})) {
      newPredictions[canonicalId][matchId] = pickNewest(newPredictions[canonicalId][matchId], pred);
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
  return {
    ...state,
    users: (state.users ?? []).filter(
      (user) => !deletedUserIds.has(user.id) && !deletedParticipantIds.has(user.participantId)
    ),
    participants: (state.participants ?? []).filter((participant) => !deletedParticipantIds.has(participant.id)),
    predictions,
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
    matches: [...matchesById.values()],
    lastResultSyncAt:
      (Number.isNaN(sharedSyncTime) ? 0 : sharedSyncTime) > (Number.isNaN(currentSyncTime) ? 0 : currentSyncTime)
        ? shared.lastResultSyncAt
        : current.lastResultSyncAt
  });
}

export async function fetchPoolState() {
  try {
    const doc = await databases.getDocument(DATABASE_ID, COLLECTION_ID, DOCUMENT_ID);
    const parsed = JSON.parse(doc.data || "{}");
    return { ...EMPTY_STATE, ...parsed };
  } catch (error) {
    if (error.code === 404) return { ...EMPTY_STATE };
    throw new Error(`Banco indisponível: ${error.message}`);
  }
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
      (u) => !deletedUserSet.has(u.id) && !deletedParticipantSet.has(u.participantId)
    ),
    participants: (merged.participants ?? []).filter((p) => !deletedParticipantSet.has(p.id)),
    predictions: Object.fromEntries(
      Object.entries(merged.predictions ?? {}).filter(([pid]) => !deletedParticipantSet.has(pid))
    ),
    deletedUserIds,
    deletedParticipantIds,
  });

  const docData = { data: JSON.stringify(payload) };
  const permissions = [
    Permission.read(Role.any()),
    Permission.update(Role.any()),
  ];

  try {
    await databases.updateDocument(DATABASE_ID, COLLECTION_ID, DOCUMENT_ID, docData);
  } catch (error) {
    if (error.code === 404) {
      await databases.createDocument(DATABASE_ID, COLLECTION_ID, DOCUMENT_ID, docData, permissions);
    } else {
      throw new Error(`Erro ao salvar: ${error.message}`);
    }
  }

  return payload;
}

export function subscribeToPoolChanges(onUpdate) {
  const channel = `databases.${DATABASE_ID}.collections.${COLLECTION_ID}.documents.${DOCUMENT_ID}`;
  return client.subscribe(channel, (response) => {
    const rawData = response.payload?.data;
    if (!rawData) return;
    try {
      onUpdate(JSON.parse(rawData));
    } catch {}
  });
}

export function unsubscribeFromPoolChanges(unsubscribeFn) {
  if (typeof unsubscribeFn === "function") unsubscribeFn();
}
