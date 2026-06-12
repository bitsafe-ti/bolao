import { createClient } from "@supabase/supabase-js";

const viteEnv = import.meta.env ?? {};

const SUPABASE_URL = viteEnv.VITE_SUPABASE_URL ?? "https://pxnkhtuxtqfcwgfsespw.supabase.co";
const SUPABASE_ANON_KEY =
  viteEnv.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB4bmtodHV4dHFmY3dnZnNlc3B3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNTkzMjgsImV4cCI6MjA5NjgzNTMyOH0.-MEbuklEnRpa6Ex5NZOAw2rCNoOeSyqVtl3PKir7F64";
const TABLE = viteEnv.VITE_SUPABASE_TABLE ?? "bolao_public_state";
const ROW_ID = viteEnv.VITE_POOL_ID ?? "copa-2026";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export function getPublicPoolState(state) {
  return {
    users: state.users ?? [],
    participants: state.participants ?? [],
    predictions: state.predictions ?? {},
    matches: state.matches ?? [],
    lastResultSyncAt: state.lastResultSyncAt ?? ""
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

export function mergePublicPoolState(current, shared = {}, options = {}) {
  const prefer = options.prefer ?? "shared";

  const matchesById = new Map();
  for (const match of mergeById(current.matches ?? [], shared.matches ?? [], prefer)) {
    const baseMatch = (current.matches ?? []).find((item) => item.id === match.id) ?? {};
    matchesById.set(match.id, { ...baseMatch, ...match });
  }

  const currentSyncTime = Date.parse(current.lastResultSyncAt || "");
  const sharedSyncTime = Date.parse(shared.lastResultSyncAt || "");

  return {
    ...current,
    users: mergeById(current.users ?? [], shared.users ?? [], prefer),
    participants: mergeById(current.participants ?? [], shared.participants ?? [], prefer),
    predictions: mergePredictionMaps(current.predictions ?? {}, shared.predictions ?? {}, prefer),
    matches: [...matchesById.values()],
    lastResultSyncAt:
      (Number.isNaN(sharedSyncTime) ? 0 : sharedSyncTime) > (Number.isNaN(currentSyncTime) ? 0 : currentSyncTime)
        ? shared.lastResultSyncAt
        : current.lastResultSyncAt
  };
}

export async function fetchPoolState() {
  const { data, error } = await supabase
    .from(TABLE)
    .select("data")
    .eq("id", ROW_ID)
    .maybeSingle();

  if (error) throw new Error(`Banco indisponível: ${error.message}`);
  return data?.data ?? { users: [], participants: [], predictions: {}, matches: [], lastResultSyncAt: "" };
}

export async function persistPoolState(nextState) {
  const remote = await fetchPoolState();
  const merged = mergePublicPoolState(nextState, remote, { prefer: "current" });
  const payload = getPublicPoolState(merged);

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
