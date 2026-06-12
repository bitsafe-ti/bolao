const viteEnv = import.meta.env ?? {};

export const SHARED_CONFIG = {
  supabaseUrl: viteEnv.VITE_SUPABASE_URL ?? "",
  supabaseAnonKey: viteEnv.VITE_SUPABASE_ANON_KEY ?? "",
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

export function mergePublicPoolState(current, shared = {}) {
  const participantsById = new Map();
  for (const participant of current.participants ?? []) {
    participantsById.set(participant.id, participant);
  }
  for (const participant of shared.participants ?? []) {
    participantsById.set(participant.id, participant);
  }

  const matchesById = new Map();
  for (const match of current.matches ?? []) {
    matchesById.set(match.id, match);
  }
  for (const match of shared.matches ?? []) {
    matchesById.set(match.id, {
      ...matchesById.get(match.id),
      ...match
    });
  }

  return {
    ...current,
    participants: [...participantsById.values()],
    predictions: {
      ...(current.predictions ?? {}),
      ...(shared.predictions ?? {})
    },
    matches: [...matchesById.values()],
    lastResultSyncAt: shared.lastResultSyncAt || current.lastResultSyncAt
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
