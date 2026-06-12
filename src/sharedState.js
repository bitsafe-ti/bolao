const viteEnv = import.meta.env ?? {};
const DEFAULT_SUPABASE_URL = "https://pxnkhtuxtqfcwgfsespw.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB4bmtodHV4dHFmY3dnZnNlc3B3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNTkzMjgsImV4cCI6MjA5NjgzNTMyOH0.-MEbuklEnRpa6Ex5NZOAw2rCNoOeSyqVtl3PKir7F64";

export const SHARED_CONFIG = {
  supabaseUrl: viteEnv.VITE_SUPABASE_URL ?? DEFAULT_SUPABASE_URL,
  supabaseAnonKey: viteEnv.VITE_SUPABASE_ANON_KEY ?? DEFAULT_SUPABASE_ANON_KEY,
  table: viteEnv.VITE_SUPABASE_TABLE ?? "bolao_public_state",
  rowId: viteEnv.VITE_POOL_ID ?? "copa-2026"
};

export function isSharedStorageEnabled(config = SHARED_CONFIG) {
  return Boolean(config.supabaseUrl && config.supabaseAnonKey);
}

function getEndpoint(config = SHARED_CONFIG) {
  const baseUrl = config.supabaseUrl.replace(/\/$/, "");
  return `${baseUrl}/rest/v1/${config.table}`;
}

function getHeaders(config = SHARED_CONFIG, extras = {}) {
  return {
    apikey: config.supabaseAnonKey,
    Authorization: `Bearer ${config.supabaseAnonKey}`,
    "Content-Type": "application/json",
    ...extras
  };
}

export function getPublicPoolState(state) {
  return {
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

  return [...ids]
    .map((id) => pickNewest(currentById[id], sharedById[id], prefer))
    .filter(Boolean);
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
    matchesById.set(match.id, {
      ...baseMatch,
      ...match
    });
  }

  const currentSyncTime = Date.parse(current.lastResultSyncAt || "");
  const sharedSyncTime = Date.parse(shared.lastResultSyncAt || "");

  return {
    ...current,
    participants: mergeById(current.participants ?? [], shared.participants ?? [], prefer),
    predictions: mergePredictionMaps(current.predictions ?? {}, shared.predictions ?? {}, prefer),
    matches: [...matchesById.values()],
    lastResultSyncAt:
      (Number.isNaN(sharedSyncTime) ? 0 : sharedSyncTime) > (Number.isNaN(currentSyncTime) ? 0 : currentSyncTime)
        ? shared.lastResultSyncAt
        : current.lastResultSyncAt
  };
}

export async function fetchSharedPoolState(config = SHARED_CONFIG) {
  if (!isSharedStorageEnabled(config)) return null;

  const url = `${getEndpoint(config)}?id=eq.${encodeURIComponent(config.rowId)}&select=data`;
  const response = await fetch(url, {
    headers: getHeaders(config)
  });

  if (!response.ok) {
    throw new Error(`Banco compartilhado indisponível (${response.status})`);
  }

  const rows = await response.json();
  return rows[0]?.data ?? { participants: [], predictions: {} };
}

export async function saveSharedPoolState(state, config = SHARED_CONFIG) {
  if (!isSharedStorageEnabled(config)) return;

  const response = await fetch(`${getEndpoint(config)}?on_conflict=id`, {
    method: "POST",
    headers: getHeaders(config, {
      Prefer: "resolution=merge-duplicates,return=minimal"
    }),
    body: JSON.stringify({
      id: config.rowId,
      data: getPublicPoolState(state),
      updated_at: new Date().toISOString()
    })
  });

  if (!response.ok) {
    throw new Error(`Não consegui salvar os palpites compartilhados (${response.status})`);
  }
}
