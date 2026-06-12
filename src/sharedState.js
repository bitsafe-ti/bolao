import { createClient } from "@supabase/supabase-js";

const viteEnv = import.meta.env ?? {};

const SUPABASE_URL = viteEnv.VITE_SUPABASE_URL || "https://pxnkhtuxtqfcwgfsespw.supabase.co";
const SUPABASE_ANON_KEY =
  viteEnv.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB4bmtodHV4dHFmY3dnZnNlc3B3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNTkzMjgsImV4cCI6MjA5NjgzNTMyOH0.-MEbuklEnRpa6Ex5NZOAw2rCNoOeSyqVtl3PKir7F64";
const TABLE = viteEnv.VITE_SUPABASE_TABLE || "bolao_public_state";
const ROW_ID = viteEnv.VITE_POOL_ID || "copa-2026";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

function filterDeleted(state) {
  const deletedUserIds = new Set(state.deletedUserIds ?? []);
  const deletedParticipantIds = new Set(state.deletedParticipantIds ?? []);
  const predictions = Object.fromEntries(
    Object.entries(state.predictions ?? {}).filter(([participantId]) => !deletedParticipantIds.has(participantId))
  );

  return {
    ...state,
    users: (state.users ?? []).filter((user) =>
      !deletedUserIds.has(user.id) && !deletedParticipantIds.has(user.participantId)
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

  return filterDeleted({
    ...current,
    deletedUserIds,
    deletedParticipantIds,
    users: mergeById(current.users ?? [], shared.users ?? [], prefer),
    participants: mergeById(current.participants ?? [], shared.participants ?? [], prefer),
    predictions: mergePredictionMaps(current.predictions ?? {}, shared.predictions ?? {}, prefer),
    matches: [...matchesById.values()],
    lastResultSyncAt:
      (Number.isNaN(sharedSyncTime) ? 0 : sharedSyncTime) > (Number.isNaN(currentSyncTime) ? 0 : currentSyncTime)
        ? shared.lastResultSyncAt
        : current.lastResultSyncAt
  });
}

export async function fetchPoolState() {
  const { data, error } = await supabase
    .from(TABLE)
    .select("data")
    .eq("id", ROW_ID)
    .maybeSingle();

  if (error) throw new Error(`Banco indisponível: ${error.message}`);
  return data?.data ?? {
    users: [],
    participants: [],
    predictions: {},
    matches: [],
    lastResultSyncAt: "",
    deletedUserIds: [],
    deletedParticipantIds: []
  };
}

export async function persistPoolState(nextState) {
  const remote = await fetchPoolState();

  // Union deleted-ID lists from both sources so deletions from either side survive
  const deletedUserIds = [
    ...new Set([...(nextState.deletedUserIds ?? []), ...(remote.deletedUserIds ?? [])])
  ];
  const deletedParticipantIds = [
    ...new Set([...(nextState.deletedParticipantIds ?? []), ...(remote.deletedParticipantIds ?? [])])
  ];
  const effectiveNext = { ...nextState, deletedUserIds, deletedParticipantIds };

  const merged = mergePublicPoolState(effectiveNext, remote, { prefer: "current" });

  // Hard filter: entities whose IDs are in the union deleted lists must never resurface
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

  const { error } = await supabase
    .from(TABLE)
    .upsert({ id: ROW_ID, data: payload, updated_at: new Date().toISOString() }, { onConflict: "id" });

  if (error) throw new Error(`Erro ao salvar: ${error.message}`);
  return payload;
}

export function subscribeToPoolChanges(onUpdate) {
  return supabase
    .channel("bolao-pool-updates")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: TABLE, filter: `id=eq.${ROW_ID}` },
      (payload) => {
        const data = payload.new?.data;
        if (data) onUpdate(data);
      }
    )
    .subscribe();
}

export function unsubscribeFromPoolChanges(channel) {
  if (channel) supabase.removeChannel(channel);
}
