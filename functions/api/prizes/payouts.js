const EMPTY_STATE = {
  users: [],
  participants: [],
  predictions: {},
  payments: {},
  paymentEvents: [],
  prizePayouts: {},
  auditLogs: [],
  notifications: [],
  matches: [],
  lastResultSyncAt: "",
  lastResultSyncSource: "",
  releasedPredictionRound: 1,
  deletedUserIds: [],
  deletedParticipantIds: []
};

const MAX_WRITE_ATTEMPTS = 3;

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(init.headers ?? {})
    }
  });
}

function getDb(context) {
  const db = context.env.DB;
  if (!db) throw new Error("Binding D1 DB nao configurado.");
  return db;
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

async function readPoolStateRecord(db, poolId) {
  await ensureSchema(db);
  const row = await db
    .prepare("select data, updated_at from pool_state where id = ?")
    .bind(poolId)
    .first();

  if (!row?.data) return { state: { ...EMPTY_STATE }, version: null };
  return { state: { ...EMPTY_STATE, ...JSON.parse(row.data) }, version: row.updated_at };
}

async function updatePoolState(db, poolId, updater) {
  await ensureSchema(db);
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
    const snapshot = await readPoolStateRecord(db, poolId);
    const nextState = await updater(snapshot.state);
    const now = new Date().toISOString();
    const write = await db.prepare(`
      insert into pool_state (id, data, created_at, updated_at)
      values (?, ?, ?, ?)
      on conflict(id) do update set
        data = excluded.data,
        updated_at = excluded.updated_at
      where pool_state.updated_at = ?
    `).bind(poolId, JSON.stringify(nextState), now, now, snapshot.version).run();

    if ((write.meta?.changes ?? 0) > 0) return nextState;
  }

  throw new Error("Nao foi possivel salvar devido a atualizacoes concorrentes.");
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

function normalizeCpfCnpj(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function cleanPayout(payout = {}) {
  return {
    holderName: String(payout.holderName || "").trim(),
    holderDocument: normalizeCpfCnpj(payout.holderDocument),
    pixKeyType: String(payout.pixKeyType || "cpf").trim(),
    pixKey: String(payout.pixKey || "").trim(),
    bankName: String(payout.bankName || "").trim(),
    notes: String(payout.notes || "").trim()
  };
}

function validatePayout(payout) {
  if (!payout.holderName) return "Informe o nome do titular da conta de premio.";
  if (![11, 14].includes(payout.holderDocument.length)) return "Informe CPF ou CNPJ valido do titular.";
  if (!payout.pixKey) return "Informe a chave Pix para recebimento do premio.";
  return "";
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const poolId = url.searchParams.get("poolId") || "copa-2026";
    const { state } = await readPoolStateRecord(getDb(context), poolId);
    return jsonResponse({ prizePayouts: state.prizePayouts ?? {} });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const poolId = body.poolId || "copa-2026";
    const participantId = body.participantId;
    if (!participantId) return jsonResponse({ error: "Participante nao informado." }, { status: 400 });

    const payout = cleanPayout(body.payout);
    const validationError = validatePayout(payout);
    if (validationError) return jsonResponse({ error: validationError }, { status: 400 });

    const db = getDb(context);
    const nextState = await updatePoolState(db, poolId, (current) => {
      const participant = (current.participants ?? []).find((item) => item.id === participantId);
      if (!participant) throw new Error("Participante nao encontrado.");

      const updatedAt = new Date().toISOString();
      const participantStatus = {
        hasData: true,
        updatedAt
      };

      return {
        ...current,
        participants: (current.participants ?? []).map((item) =>
          item.id === participantId
            ? {
                ...stripSensitiveParticipantData(item),
                prizePayoutStatus: participantStatus,
                updatedAt
              }
            : stripSensitiveParticipantData(item)
        ),
        prizePayouts: {
          ...(current.prizePayouts ?? {}),
          [participantId]: {
            ...payout,
            participantId,
            updatedAt
          }
        },
        auditLogs: [
          {
            id: `prize-${participantId}-${Date.now()}`,
            actor: participant.name || "Participante",
            action: "prize_payout_updated",
            details: "dados de recebimento de premio atualizados",
            createdAt: updatedAt
          },
          ...(current.auditLogs ?? [])
        ].slice(0, 1000)
      };
    });

    return jsonResponse({
      saved: true,
      state: getPublicState(nextState)
    });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
}
