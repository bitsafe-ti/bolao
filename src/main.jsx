import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTrophy, faTrash } from "@fortawesome/free-solid-svg-icons";
import {
  calculateRanking,
  createInitialState,
  emptyPrediction,
  getActiveRound,
  getMatchRound,
  getReleasedPredictionRound,
  isMatchClosed,
  makeId,
  normalizeUsers,
  purgeClearedOpeningPredictions,
  purgeExpiredPredictions,
  purgeFutureRoundPredictions
} from "./domain.js";
import { getFlagUrl, getTeamsByGroup, teamsById } from "./teams.js";
import { attachPasswordCredential, hasLegacyPassword, verifyPassword } from "./passwords.js";
import { applyResultUpdates, fetchWorldCupResults } from "./resultsSync.js";
import {
  fetchPoolState,
  fetchPoolStateFromPool,
  mergePublicPoolState,
  persistPoolState,
  subscribeToPoolChanges,
  unsubscribeFromPoolChanges
} from "./sharedState.js";
import "./styles.css";

const ACTIVE_POOL_ID = import.meta.env.VITE_POOL_ID || "copa-2026";
const DEFAULT_SUPER_ADMIN_EMAIL = "guilhermesaraiva.rocha@hotmail.com";
const SUPER_ADMIN_EMAILS = new Set(
  [
    ...(import.meta.env.VITE_SUPER_ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean),
    ...(import.meta.env.DEV ? [DEFAULT_SUPER_ADMIN_EMAIL] : []),
  ]
);
const PRIMARY_POOL_ID = "copa-2026";
const STORAGE_SCOPE = ACTIVE_POOL_ID === "copa-2026" ? "" : `:${ACTIVE_POOL_ID}`;
const SESSION_KEY = `bolao-copa-2026${STORAGE_SCOPE}:session`;
const CACHE_KEY = `bolao-copa-2026${STORAGE_SCOPE}:cache`;
const DEV_POOL_SEEDED_KEY = `bolao-copa-2026${STORAGE_SCOPE}:seeded`;
const LEGACY_DATA_KEY = "bolao-copa-2026:v1";
const DATA_LOAD_TIMEOUT_MS = 7000;
const ENTRY_FEE = 20;
const SIDEMENU_LOGO_URL = `${import.meta.env.BASE_URL}sidemenu-logo.png`;
const AUTH_LOGO_URL = `${import.meta.env.BASE_URL}logo_bolao_transparente.png`;
const WORLD_CUP_LOGO_URL =
  "https://upload.wikimedia.org/wikipedia/commons/a/ab/2026_FIFA_World_Cup_emblem_%28horizontal_lockup%29.svg";

function loadSession() {
  try {
    const saved = sessionStorage.getItem(SESSION_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

function saveSession(updates) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...loadSession(), ...updates }));
  } catch {}
}

function loadCachedPoolState() {
  try {
    const saved = localStorage.getItem(CACHE_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

function saveCachedPoolState(state) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      users: state.users ?? [],
      participants: state.participants ?? [],
      predictions: state.predictions ?? {},
      auditLogs: state.auditLogs ?? [],
      matches: state.matches ?? [],
      lastResultSyncAt: state.lastResultSyncAt ?? "",
      releasedPredictionRound: Number(state.releasedPredictionRound) || 1,
      deletedUserIds: state.deletedUserIds ?? [],
      deletedParticipantIds: state.deletedParticipantIds ?? []
    }));
  } catch {}
}

function hasMeaningfulPoolData(state) {
  return Boolean(
    state?.users?.length ||
    state?.participants?.length ||
    Object.keys(state?.predictions ?? {}).length
  );
}

function wasDevPoolSeeded() {
  try {
    return localStorage.getItem(DEV_POOL_SEEDED_KEY) === "1";
  } catch {
    return false;
  }
}

function markDevPoolSeeded() {
  try {
    localStorage.setItem(DEV_POOL_SEEDED_KEY, "1");
  } catch {}
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
}

const userTabs = [
  { id: "predictions", label: "Palpites" },
  { id: "results", label: "Resultados" },
  { id: "groups", label: "Grupos" },
  { id: "ranking", label: "Ranking" }
];

const adminTabs = [
  { id: "participants", label: "Participantes" },
  { id: "rounds", label: "Rodadas" },
  ...userTabs.filter((tab) => tab.id !== "audit"),
  { id: "audit", label: "Auditoria" }
];

const defaultRounds = [1, 2, 3];
const AUDIT_LOG_LIMIT = 1000;
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
const RESULT_SYNC_IDLE_MS = 5 * 60 * 1000;
const RESULT_SYNC_LIVE_MS = 30 * 1000;
const RESULT_SYNC_LIVE_BEFORE_MS = 30 * 60 * 1000;
const RESULT_SYNC_LIVE_AFTER_MS = 4 * 60 * 60 * 1000;

function applyRemoteData(current, remoteData, { prefer = "shared" } = {}) {
  const merged = mergePublicPoolState(current, remoteData, { prefer });
  return cleanPoolState({
    ...merged,
    users: normalizeUsers(merged.users ?? [], SUPER_ADMIN_EMAILS),
    currentUserId: current.currentUserId,
    activeParticipantId: current.activeParticipantId
  });
}

function cleanPoolState(state) {
  return purgeClearedOpeningPredictions(purgeExpiredPredictions(purgeFutureRoundPredictions(state)));
}

function parseScoreValue(value) {
  if (value === "" || value === null || value === undefined) return null;
  const score = Number(value);
  return Number.isInteger(score) ? score : null;
}

function shouldUseFastResultSync(matches, now = new Date()) {
  const nowTime = now.getTime();
  return matches.some((match) => {
    if (parseScoreValue(match.homeScore) !== null && parseScoreValue(match.awayScore) !== null) return false;
    const kickoffTime = Date.parse(match.date || "");
    if (Number.isNaN(kickoffTime)) return false;
    return nowTime >= kickoffTime - RESULT_SYNC_LIVE_BEFORE_MS && nowTime <= kickoffTime + RESULT_SYNC_LIVE_AFTER_MS;
  });
}

function maskEmail(email = "") {
  const [name = "", domain = ""] = String(email).split("@");
  if (!name || !domain) return "";
  const visible = name.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(2, name.length - 2))}@${domain}`;
}

function appendAuditLog(state, entry) {
  return {
    ...state,
    auditLogs: [entry, ...(state.auditLogs ?? [])].slice(0, AUDIT_LOG_LIMIT)
  };
}

function makeAuditEntry(actor, action, details = "") {
  return { id: makeId("audit"), createdAt: new Date().toISOString(), actor, action, details };
}

function App() {
  const [state, setState] = useState(createInitialState);
  const [isLoading, setIsLoading] = useState(true);
  const [tab, setTab] = useState("predictions");
  const [authError, setAuthError] = useState("");
  const [syncStatus, setSyncStatus] = useState({ state: "idle", message: "Resultados automáticos ativos." });
  const [sharedStatus, setSharedStatus] = useState({ state: "idle", message: "Carregando dados do bolão..." });
  const [selectedPredictionRound, setSelectedPredictionRound] = useState(null);
  const [selectedResultRound, setSelectedResultRound] = useState(null);
  const [draftPredictions, setDraftPredictions] = useState({});
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [participantModalOpen, setParticipantModalOpen] = useState(false);
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const [historyTeamId, setHistoryTeamId] = useState("");
  const [clockNow, setClockNow] = useState(() => new Date());
  const workspaceRef = useRef(null);
  const lastActivityRef = useRef(Date.now());

  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  const isAdmin = currentUser?.role === "admin";
  const visibleTabs = isAdmin ? adminTabs : userTabs;
  const adminParticipantIds = useMemo(
    () => new Set(state.users.filter((user) => user.role === "admin").map((user) => user.participantId).filter(Boolean)),
    [state.users]
  );
  const contestParticipants = state.participants;
  const ranking = useMemo(
    () => calculateRanking(contestParticipants, state.matches, state.predictions),
    [contestParticipants, state.matches, state.predictions]
  );
  const groupStandings = useMemo(() => calculateGroupStandings(state.matches), [state.matches]);
  const automaticRound = useMemo(() => getActiveRound(state.matches), [state.matches]);
  const activeRound = useMemo(() => getReleasedPredictionRound(state), [state.matches, state.releasedPredictionRound]);
  const availableRounds = useMemo(() => {
    return [...new Set(
      state.matches.map((m) => getMatchRound(m)).filter((r) => r !== null && !Number.isNaN(r))
    )].sort((a, b) => a - b);
  }, [state.matches]);
  const activePredictionRound = selectedPredictionRound ?? activeRound;
  const activeResultRound = selectedResultRound ?? automaticRound;
  const predictionMatches = state.matches
    .filter((match) => getMatchRound(match) === activePredictionRound)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const resultMatches = state.matches
    .filter((match) => getMatchRound(match) === activeResultRound)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const resultSyncIntervalMs = useMemo(
    () => shouldUseFastResultSync(state.matches, clockNow) ? RESULT_SYNC_LIVE_MS : RESULT_SYNC_IDLE_MS,
    [state.matches, clockNow]
  );
  const resultSyncIntervalText =
    resultSyncIntervalMs === RESULT_SYNC_LIVE_MS
      ? "Atualização em tempo quase real: checagem a cada 30 segundos durante jogos próximos ou em andamento."
      : "A atualização roda ao entrar e a cada 5 minutos fora de jogos próximos ou em andamento.";
  const userRows = useMemo(() => {
    const participantById = new Map(state.participants.map((participant) => [participant.id, participant]));
    const linkedParticipantIds = new Set(state.users.map((user) => user.participantId).filter(Boolean));
    const fromUsers = state.users.map((user) => {
      const participant = participantById.get(user.participantId);
      return {
        id: user.id,
        userId: user.id,
        participantId: user.participantId || participant?.id || "",
        name: user.name || participant?.name || "",
        email: user.email || participant?.email || "",
        role: user.role,
        linkedUser: user,
        participant
      };
    });
    const orphanParticipants = state.participants
      .filter((participant) => !linkedParticipantIds.has(participant.id))
      .map((participant) => ({
        id: participant.id,
        userId: "",
        participantId: participant.id,
        name: participant.name || "",
        email: participant.email || "",
        role: "user",
        linkedUser: null,
        participant,
        orphan: true
      }));

    return [...fromUsers, ...orphanParticipants].sort((a, b) => a.name.localeCompare(b.name));
  }, [state.participants, state.users]);
  const adminParticipantRows = userRows.filter((row) => row.role === "admin");
  const regularParticipantRows = userRows.filter((row) => row.role !== "admin");
  const historyTeam = historyTeamId ? teamsById[historyTeamId] : null;

  useEffect(() => {
    const now = Date.now();
    const nextKickoffTime = state.matches
      .map((match) => Date.parse(match.date || ""))
      .filter((time) => !Number.isNaN(time) && time > now)
      .sort((a, b) => a - b)[0];

    if (!nextKickoffTime) return undefined;

    const delay = Math.min(nextKickoffTime - now + 1000, 2_147_483_647);
    const timeoutId = window.setTimeout(() => setClockNow(new Date()), delay);
    return () => window.clearTimeout(timeoutId);
  }, [clockNow, state.matches]);

  useEffect(() => {
    const cleaned = cleanPoolState(state);
    if (cleaned === state) return;
    setState(cleaned);
    saveCachedPoolState(cleaned);
  }, [state]);

  useEffect(() => {
    if (!participantModalOpen) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") setParticipantModalOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [participantModalOpen]);

  // Initial load from Cloudflare D1 (with one-time migration from legacy localStorage)
  useEffect(() => {
    async function init() {
      const session = loadSession();
      const cached = loadCachedPoolState();

      if (cached) {
        setState((current) => {
          const merged = mergePublicPoolState(current, cached, { prefer: "shared" });
          return cleanPoolState({
            ...merged,
            users: normalizeUsers(merged.users ?? [], SUPER_ADMIN_EMAILS),
            currentUserId: session.currentUserId ?? "",
            activeParticipantId: session.activeParticipantId ?? ""
          });
        });
        setIsLoading(false);
        setSharedStatus({ state: "loading", message: "Atualizando dados do banco..." });
      }

      try {
        let remote = await withTimeout(
          fetchPoolState(),
          DATA_LOAD_TIMEOUT_MS,
          "Tempo excedido ao carregar dados do banco."
        );

        if (ACTIVE_POOL_ID !== PRIMARY_POOL_ID && !wasDevPoolSeeded() && !hasMeaningfulPoolData(remote)) {
          try {
            const seededRemote = await withTimeout(
              fetchPoolStateFromPool(PRIMARY_POOL_ID),
              DATA_LOAD_TIMEOUT_MS,
              "Tempo excedido ao copiar dados do ambiente principal."
            );
            if (hasMeaningfulPoolData(seededRemote)) {
              remote = seededRemote;
              try {
                await persistPoolState(seededRemote);
                markDevPoolSeeded();
              } catch {}
            }
          } catch {}
        }

        // Migrate any data saved by the old local-first architecture
        let legacyData = null;
        try {
          const raw = localStorage.getItem(LEGACY_DATA_KEY);
          if (raw) {
            legacyData = JSON.parse(raw);
            localStorage.removeItem(LEGACY_DATA_KEY);
          }
        } catch {}

        const base = legacyData
          ? mergePublicPoolState(remote, legacyData, { prefer: "current" })
          : remote;
        const cleanedBase = cleanPoolState(base);
        saveCachedPoolState(cleanedBase);
        setState((current) => {
          // If legacy data exists, merge it so we don't lose local-only registrations
          const merged = mergePublicPoolState(current, cleanedBase, { prefer: "shared" });
          const next = {
            ...merged,
            users: normalizeUsers(merged.users ?? [], SUPER_ADMIN_EMAILS),
            currentUserId: session.currentUserId ?? "",
            activeParticipantId: session.activeParticipantId ?? ""
          };
          return cleanPoolState(next);
        });

        // Only persist when migrating legacy localStorage data.
        // Purge-only changes are intentionally skipped here to avoid a race condition where
        // this write (with auditLogs from the initial D1 fetch) races against a concurrent
        // syncResults write and overwrites audit log entries that syncResults just persisted.
        // Purge is idempotent - expired predictions are removed on every client load, and the
        // next user action will persist the cleaned state via persistAndSync anyway.
        if (legacyData) {
          try { await persistPoolState(cleanedBase); } catch {}
        }

        setSharedStatus({ state: "success", message: "Dados sincronizados com o banco." });
      } catch (error) {
        setSharedStatus({ state: "error", message: `Erro ao carregar dados: ${error.message}` });
      } finally {
        setIsLoading(false);
      }
    }
    void init();
  }, []);

  // Real-time subscription
  useEffect(() => {
    const channel = subscribeToPoolChanges((remoteData) => {
      const cleanedRemote = cleanPoolState(remoteData);
      saveCachedPoolState(cleanedRemote);
      setState((current) => applyRemoteData(current, cleanedRemote));
      // Do not persist purge-only changes from background reads - same race condition
      // concern as init(): a concurrent persistAndSync from a user action may have already
      // written audit logs that this stale-fetched state would overwrite.
      setSharedStatus({ state: "success", message: "Atualizado em tempo real." });
    });
    return () => unsubscribeFromPoolChanges(channel);
  }, []);

  // Polling fallback every 30s in case Realtime misses an update
  useEffect(() => {
    const intervalId = window.setInterval(async () => {
      try {
        const remote = await withTimeout(
          fetchPoolState(),
          DATA_LOAD_TIMEOUT_MS,
          "Tempo excedido ao atualizar dados do banco."
        );
        const cleanedRemote = cleanPoolState(remote);
        saveCachedPoolState(cleanedRemote);
        setState((current) => applyRemoteData(current, cleanedRemote));
        // Do not persist purge-only changes from background reads - same race condition
        // concern as init(): a concurrent persistAndSync from a user action may have already
        // written audit logs that this stale-fetched state would overwrite.
      } catch {}
    }, 30_000);
    return () => window.clearInterval(intervalId);
  }, []);

  // Auto-sync results when logged in
  useEffect(() => {
    if (!currentUser) return undefined;
    syncResults("auto");
    const intervalId = window.setInterval(() => syncResults("auto"), resultSyncIntervalMs);
    return () => window.clearInterval(intervalId);
  }, [currentUser?.id, resultSyncIntervalMs]);

  useEffect(() => {
    if (!visibleTabs.some((item) => item.id === tab)) {
      setTab("predictions");
    }
  }, [tab, visibleTabs]);

  useEffect(() => {
    if (!currentUser?.id) return;

    function onActivity() {
      lastActivityRef.current = Date.now();
    }

    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    lastActivityRef.current = Date.now();

    const interval = setInterval(() => {
      if (Date.now() - lastActivityRef.current >= INACTIVITY_TIMEOUT_MS) {
        clearInterval(interval);
        saveSession({ currentUserId: "", activeParticipantId: "" });
        setState((s) => ({ ...s, currentUserId: "", activeParticipantId: "" }));
        setAuthError("Sessão encerrada por inatividade.");
      }
    }, 10000);

    return () => {
      events.forEach((e) => window.removeEventListener(e, onActivity));
      clearInterval(interval);
    };
  }, [currentUser?.id]);

  function handleTabClick(tabId) {
    setTab(tabId);
    setMobileMenuOpen(false);
    window.requestAnimationFrame(() => {
      workspaceRef.current?.scrollTo({ top: 0, behavior: "auto" });
    });
  }

  // Optimistically update state then persist to Cloudflare D1
  function updateState(recipe) {
    // Compute nextState using the current closure value of `state` so it is
    // available synchronously - React 19 batches setState callbacks lazily
    // and the updater may not run before persistAndSync needs the value.
    const nextState = typeof recipe === "function" ? recipe(state) : recipe;
    // Skip persist when the recipe returned the same reference (e.g. syncResults
    // with 0 changed matches). An extra write would race with concurrent writes
    // and could overwrite audit logs written by those concurrent calls.
    if (nextState === state) return;
    setState(nextState);
    void persistAndSync(nextState);
  }

  async function persistAndSync(nextState) {
    saveCachedPoolState(nextState);
    try {
      const saved = await persistPoolState(nextState);
      const cleanedSaved = cleanPoolState(saved);
      saveCachedPoolState(cleanedSaved);
      // prefer: "current" - local deletions and edits always win over the just-saved remote snapshot
      setState((current) => applyRemoteData(current, cleanedSaved, { prefer: "current" }));
    } catch (error) {
      setSharedStatus({ state: "error", message: `Erro ao salvar: ${error.message}` });
    }
  }

  async function syncResults(mode = "manual") {
    setSyncStatus({ state: "loading", message: "Atualizando resultados..." });
    try {
      const sourceMatches = await fetchWorldCupResults();
      // Compute against current closure state to know whether a D1 write is needed.
      const preview = applyResultUpdates(state.matches, sourceMatches);
      const changed = preview.changed;
      const now = new Date().toISOString();

      if (changed > 0) {
        // Real changes: write to D1 and append audit log.
        // The recipe re-runs against the latest state snapshot to avoid stale data.
        updateState((current) => {
          const update = applyResultUpdates(current.matches, sourceMatches);
          return appendAuditLog(
            { ...current, matches: update.matches, lastResultSyncAt: now },
            makeAuditEntry(
              currentUser?.name ?? "Sistema",
              "results_synced",
              `${update.changed} jogo${update.changed === 1 ? "" : "s"} atualizado${update.changed === 1 ? "" : "s"}`
            )
          );
        });
      } else {
        // No changes: update lastResultSyncAt locally only - no D1 write.
        // Writing to D1 here with auditLogs from a potentially stale local state
        // would race with concurrent persistAndSync calls and overwrite audit logs.
        setState((current) => ({ ...current, lastResultSyncAt: now }));
      }

      setSyncStatus({
        state: "success",
        message:
          changed > 0
            ? `${changed} jogos sincronizados.`
            : `Sem novos resultados. Última verificação ${formatShortTime(new Date())}.`
      });
    } catch (error) {
      setSyncStatus({ state: "error", message: `Não consegui atualizar agora. ${error.message}` });
    }
  }

  async function registerUser({ firstName, lastName, email, password }) {
    const cleanName = `${(firstName || "").trim()} ${(lastName || "").trim()}`.trim();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanName || !cleanEmail || !password) {
      setAuthError("Preencha nome, sobrenome, e-mail e senha para criar sua conta.");
      return;
    }
    if (!cleanEmail.includes("@") || !cleanEmail.includes(".")) {
      setAuthError("Informe um e-mail válido.");
      return;
    }
    const emailTaken =
      state.users.some((u) => u.email === cleanEmail) ||
      state.participants.some((p) => p.email === cleanEmail);
    if (emailTaken) {
      setAuthError("Este e-mail já está cadastrado. Entre com sua senha.");
      return;
    }

    const now = new Date().toISOString();
    const participant = { id: makeId("participant"), name: cleanName, email: cleanEmail, updatedAt: now };
    let user;
    try {
      user = await attachPasswordCredential({
        id: makeId("user"),
        name: cleanName,
        email: cleanEmail,
        role: "user",
        favoriteTeamId: "",
        participantId: participant.id,
        createdAt: now
      }, password);
    } catch (error) {
      setAuthError(error.message);
      return;
    }

    saveSession({ currentUserId: user.id, activeParticipantId: participant.id });
    updateState((current) => appendAuditLog(
      {
        ...current,
        users: [...current.users, user],
        participants: [...current.participants, participant],
        currentUserId: user.id,
        activeParticipantId: participant.id
      },
      makeAuditEntry(cleanName, "user_registered", maskEmail(cleanEmail))
    ));
    setAuthError("");
  }

  async function loginUser({ email, password }) {
    const cleanEmail = email.trim().toLowerCase();
    const user = state.users.find((item) => item.email === cleanEmail);
    const validPassword = user ? await verifyPassword(user, password) : false;
    if (!user || !validPassword) {
      setAuthError("E-mail ou senha inválidos.");
      return;
    }
    const session = { currentUserId: user.id, activeParticipantId: user.participantId || "" };
    saveSession(session);
    if (hasLegacyPassword(user)) {
      let migratedUser;
      try {
        migratedUser = await attachPasswordCredential(user, password);
      } catch (error) {
        setAuthError(error.message);
        return;
      }
      updateState((current) => ({
        ...current,
        ...session,
        users: current.users.map((item) => (item.id === user.id ? migratedUser : item))
      }));
    } else {
      setState((current) => ({ ...current, ...session }));
    }
    setAuthError("");
  }

  function logoutUser() {
    saveSession({ currentUserId: "", activeParticipantId: "" });
    setState((current) => ({ ...current, currentUserId: "", activeParticipantId: "" }));
  }

  async function addParticipant(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = form.get("name").trim();
    const email = (form.get("email") || "").trim().toLowerCase();
    const password = (form.get("password") || "").trim();
    if (!name || !email || !password) return;
    if (!email.includes("@") || !email.includes(".")) {
      setSharedStatus({ state: "error", message: "Informe um e-mail válido." });
      return;
    }
    const emailTaken =
      state.users.some((u) => u.email === email) ||
      state.participants.some((p) => p.email === email);
    if (emailTaken) {
      setSharedStatus({ state: "error", message: "Este e-mail já está cadastrado." });
      return;
    }
    const now = new Date().toISOString();
    const participant = { id: makeId("participant"), name, email, updatedAt: now };
    let user;
    try {
      user = await attachPasswordCredential({
        id: makeId("user"),
        name,
        email,
        role: "user",
        favoriteTeamId: "",
        participantId: participant.id,
        createdAt: now,
        updatedAt: now
      }, password);
    } catch (error) {
      setSharedStatus({ state: "error", message: error.message });
      return;
    }
    updateState((current) => appendAuditLog(
      {
        ...current,
        users: [...current.users, user],
        participants: [...current.participants, participant],
        activeParticipantId: current.activeParticipantId || participant.id
      },
      makeAuditEntry(currentUser?.name ?? "Admin", "participant_added", name)
    ));
    event.currentTarget.reset();
    setParticipantModalOpen(false);
  }

  function updateParticipantRow(row, field, value) {
    const nextValue = field === "email" ? value.trim().toLowerCase() : value;
    updateState((current) => ({
      ...current,
      participants: current.participants.map((participant) =>
        participant.id === row.participantId
          ? { ...participant, [field]: nextValue, updatedAt: new Date().toISOString() }
          : participant
      ),
      users: current.users.map((user) =>
        user.id === row.userId
          ? { ...user, [field]: nextValue, updatedAt: new Date().toISOString() }
          : user
      )
    }));
  }

  function removeParticipantRow(row) {
    updateState((current) => {
      const userIdsToRemove = new Set(row.userId ? [row.userId] : []);
      const participantIdsToRemove = new Set(row.participantId ? [row.participantId] : []);

      for (const user of current.users) {
        if (participantIdsToRemove.has(user.participantId)) userIdsToRemove.add(user.id);
      }

      for (const user of current.users) {
        if (userIdsToRemove.has(user.id) && user.participantId) {
          participantIdsToRemove.add(user.participantId);
        }
      }

      const predictions = { ...current.predictions };
      for (const participantId of participantIdsToRemove) {
        delete predictions[participantId];
      }

      const users = current.users.filter((user) => !userIdsToRemove.has(user.id));
      const participants = current.participants.filter((participant) => !participantIdsToRemove.has(participant.id));

      return appendAuditLog(
        {
          ...current,
          users,
          participants,
          predictions,
          deletedUserIds: [...new Set([...(current.deletedUserIds ?? []), ...userIdsToRemove])],
          deletedParticipantIds: [...new Set([...(current.deletedParticipantIds ?? []), ...participantIdsToRemove])],
          activeParticipantId: participantIdsToRemove.has(current.activeParticipantId)
            ? participants[0]?.id ?? ""
            : current.activeParticipantId
        },
        makeAuditEntry(currentUser?.name ?? "Admin", "participant_removed", row.name)
      );
    });
  }

  function addMatch(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const match = {
      id: makeId("match"),
      phase: form.get("phase").trim() || "Fase de grupos",
      round: Number(form.get("round")) || 1,
      date: form.get("date"),
      homeTeamId: form.get("homeTeamId"),
      awayTeamId: form.get("awayTeamId"),
      homeScore: "",
      awayScore: "",
      homeGoals: [],
      awayGoals: [],
      updatedAt: new Date().toISOString()
    };
    if (!match.homeTeamId || !match.awayTeamId || match.homeTeamId === match.awayTeamId) return;
    const homeTeamName = teamsById[match.homeTeamId]?.name ?? match.homeTeamId;
    const awayTeamName = teamsById[match.awayTeamId]?.name ?? match.awayTeamId;
    updateState((current) => appendAuditLog(
      { ...current, matches: [...current.matches, match] },
      makeAuditEntry(currentUser?.name ?? "Admin", "match_added", `${homeTeamName} x ${awayTeamName}`)
    ));
    event.currentTarget.reset();
  }

  function updateMatch(matchId, field, value) {
    updateState((current) => ({
      ...current,
      matches: current.matches.map((match) =>
        match.id === matchId ? { ...match, [field]: value, updatedAt: new Date().toISOString() } : match
      )
    }));
  }

  function removeMatch(matchId) {
    updateState((current) => {
      const match = current.matches.find((m) => m.id === matchId);
      const home = teamsById[match?.homeTeamId]?.name ?? match?.homeTeamId ?? matchId;
      const away = teamsById[match?.awayTeamId]?.name ?? match?.awayTeamId ?? "";
      const predictions = Object.fromEntries(
        Object.entries(current.predictions).map(([participantId, participantPredictions]) => {
          const nextPredictions = { ...participantPredictions };
          delete nextPredictions[matchId];
          return [participantId, nextPredictions];
        })
      );
      return appendAuditLog(
        { ...current, matches: current.matches.filter((m) => m.id !== matchId), predictions },
        makeAuditEntry(currentUser?.name ?? "Admin", "match_removed", [home, away].filter(Boolean).join(" x "))
      );
    });
  }

  function getPredictionKey(participantId, matchId) {
    return `${participantId}__${matchId}`;
  }

  function getDraftPrediction(participantId, matchId, storedPrediction = emptyPrediction) {
    return draftPredictions[getPredictionKey(participantId, matchId)] ?? storedPrediction;
  }

  function updateDraftPrediction(participantId, matchId, field, value) {
    const key = getPredictionKey(participantId, matchId);
    setDraftPredictions((current) => ({
      ...current,
      [key]: { ...emptyPrediction, ...current[key], [field]: value }
    }));
  }

  function savePrediction(participantId, matchId) {
    const key = getPredictionKey(participantId, matchId);
    const match = state.matches.find((item) => item.id === matchId);
    const currentPrediction = state.predictions[participantId]?.[matchId] ?? emptyPrediction;
    if (getMatchRound(match) > activeRound || isMatchClosed(match)) return;

    const draft = getDraftPrediction(participantId, matchId, currentPrediction);
    // Treat blank input as 0 - user leaving the field empty means "zero gols"
    const normalizedDraft = {
      home: draft.home !== "" ? draft.home : "0",
      away: draft.away !== "" ? draft.away : "0",
    };

    const participant = state.participants.find((p) => p.id === participantId);
    const actorName = participant?.name ?? currentUser?.name ?? "Participante";
    const homeTeam = teamsById[match?.homeTeamId]?.name ?? "?";
    const awayTeam = teamsById[match?.awayTeamId]?.name ?? "?";
    const detail = `${homeTeam} ${normalizedDraft.home} x ${normalizedDraft.away} ${awayTeam}`;

    const savedAt = new Date().toISOString();
    updateState((current) => appendAuditLog(
      {
        ...current,
        predictions: {
          ...current.predictions,
          [participantId]: {
            ...current.predictions[participantId],
            [matchId]: { ...emptyPrediction, ...current.predictions[participantId]?.[matchId], ...normalizedDraft, savedAt, updatedAt: savedAt }
          }
        }
      },
      makeAuditEntry(actorName, "prediction_saved", detail)
    ));
    setDraftPredictions((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async function resetPassword(userId, newPassword) {
    const user = state.users.find((item) => item.id === userId);
    if (!user) return;
    let updatedUser;
    try {
      updatedUser = await attachPasswordCredential({ ...user, updatedAt: new Date().toISOString() }, newPassword);
    } catch (error) {
      setSharedStatus({ state: "error", message: error.message });
      return;
    }
    updateState((current) => appendAuditLog(
      {
        ...current,
        users: current.users.map((u) => u.id === userId ? updatedUser : u)
      },
      makeAuditEntry(currentUser?.name ?? "Admin", "password_reset", user.name)
    ));
  }

  function resetData() {
    if (!confirm("Apagar todos os dados do bolão? Esta ação não pode ser desfeita.")) return;
    updateState(appendAuditLog(
      createInitialState(),
      makeAuditEntry(currentUser?.name ?? "Admin", "data_reset", "")
    ));
  }

  function releasePredictionRound(round) {
    updateState((current) => appendAuditLog(
      {
        ...current,
        releasedPredictionRound: Math.max(Number(current.releasedPredictionRound) || 1, Number(round) || 1)
      },
      makeAuditEntry(currentUser?.name ?? "Admin", "round_released", `Rodada ${round}`)
    ));
    setSharedStatus({ state: "success", message: `Rodada ${round} liberada para votação.` });
  }

  function lockRound(round) {
    const now = new Date().toISOString();
    updateState((current) => appendAuditLog(
      {
        ...current,
        matches: current.matches.map((m) =>
          getMatchRound(m) === round ? { ...m, locked: true, updatedAt: now } : m
        )
      },
      makeAuditEntry(currentUser?.name ?? "Admin", "round_locked", `Rodada ${round}`)
    ));
    setSharedStatus({ state: "success", message: `Rodada ${round} travada manualmente.` });
  }

  if (isLoading) {
    return (
      <main className="loading-page">
        <div className="loading-block">
          <img src={WORLD_CUP_LOGO_URL} alt="Copa do Mundo 2026" style={{ width: 200, opacity: 0.8 }} />
          <p>Carregando dados do bolão...</p>
        </div>
      </main>
    );
  }

  if (!currentUser) {
    return <AuthScreen error={authError} onLogin={loginUser} onRegister={registerUser} />;
  }

  const userParticipant = state.participants.find((participant) => participant.id === currentUser.participantId);
  const activeParticipant = isAdmin
    ? state.participants.find((participant) => participant.id === state.activeParticipantId) ??
      userParticipant ??
      state.participants[0]
    : userParticipant;
  return (
    <main className="app-shell">
      {mobileMenuOpen && <div className="menu-overlay" onClick={() => setMobileMenuOpen(false)} />}
      <aside className={`sidebar${mobileMenuOpen ? " open" : ""}`}>
        <div className="brand-block">
          <img src={SIDEMENU_LOGO_URL} alt="Logo FIFA World Cup 2026" fetchPriority="high" />
          <button type="button" className="menu-close" aria-label="Fechar menu" onClick={() => setMobileMenuOpen(false)}>×</button>
        </div>
        <nav className="tabs" aria-label="Seções do bolão">
          {visibleTabs.map((item) => (
            <button type="button" className={tab === item.id ? "active" : ""} key={item.id} onClick={() => handleTabClick(item.id)}>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-actions">
            <button type="button" onClick={logoutUser}>Sair</button>
          </div>
        </div>
      </aside>

      {adminMenuOpen && isAdmin && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setAdminMenuOpen(false)}>
          <section className="modal-card admin-menu-modal" role="dialog" aria-modal="true" aria-labelledby="admin-menu-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Administrador</p>
                <h2 id="admin-menu-title">{currentUser.name}</h2>
              </div>
              <button type="button" className="modal-close" aria-label="Fechar modal" onClick={() => setAdminMenuOpen(false)}>×</button>
            </div>
            <div className="admin-modal-actions">
              <button type="button" onClick={() => { syncResults("manual"); setAdminMenuOpen(false); setMobileMenuOpen(false); }}>
                <strong>Atualizar resultados</strong>
                <span>Sincronizar os placares mais recentes da Copa.</span>
              </button>
              <button type="button" className="danger" onClick={() => { resetData(); setAdminMenuOpen(false); setMobileMenuOpen(false); }}>
                <strong>Reiniciar dados</strong>
                <span>Apagar dados do bolão e voltar ao estado inicial.</span>
              </button>
            </div>
          </section>
        </div>
      )}

      {historyTeam && (
        <TeamHistoryModal
          team={historyTeam}
          matches={state.matches}
          onClose={() => setHistoryTeamId("")}
        />
      )}

      <section className="workspace" ref={workspaceRef}>
        <header className="topbar">
          <div className="topbar-left">
            <button type="button" className="hamburger" aria-label="Abrir menu" onClick={() => setMobileMenuOpen(true)}>☰</button>
            <div className="topbar-title">
              <p className="eyebrow">Copa do Mundo 2026</p>
              <h1>{visibleTabs.find((item) => item.id === tab)?.label ?? "Bolão"}</h1>
            </div>
          </div>
          {isAdmin ? (
            <button type="button" className="topbar-user topbar-user-button" onClick={() => setAdminMenuOpen(true)}>
              <div className="topbar-user-info">
                <strong>{currentUser.name}</strong>
                <small>Admin</small>
              </div>
            </button>
          ) : (
            <div className="topbar-user">
              <div className="topbar-user-info">
                <strong>{currentUser.name}</strong>
              </div>
            </div>
          )}
        </header>

        {tab === "participants" && isAdmin && (
          <section className="panel">
            <SectionHeader title="Participantes" />
            <div className="panel-actions">
              <button type="button" onClick={() => setParticipantModalOpen(true)}>Novo contato</button>
            </div>
            <ParticipantGrid
              title="Administrador"
              rows={adminParticipantRows}
              emptyText="Nenhum administrador encontrado."
              onChange={updateParticipantRow}
              onResetPassword={resetPassword}
              onRemove={removeParticipantRow}
              canRemove
              removeLabel="Remover admin"
              protectedUserId={currentUser.id}
            />
            <ParticipantGrid
              title="Usuários"
              rows={regularParticipantRows}
              emptyText="Nenhum usuário comum cadastrado."
              onChange={updateParticipantRow}
              onResetPassword={resetPassword}
              onRemove={removeParticipantRow}
              canRemove
            />
            {participantModalOpen && (
              <div className="modal-backdrop" role="presentation" onMouseDown={() => setParticipantModalOpen(false)}>
                <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="participant-modal-title" onMouseDown={(event) => event.stopPropagation()}>
                  <div className="modal-header">
                    <div>
                      <p className="eyebrow">Participantes</p>
                      <h2 id="participant-modal-title">Novo contato</h2>
                    </div>
                    <button type="button" className="modal-close" aria-label="Fechar modal" onClick={() => setParticipantModalOpen(false)}>×</button>
                  </div>
                  <form className="modal-form participant-form" onSubmit={addParticipant}>
                    <input name="name" placeholder="Nome do participante" autoFocus />
                    <input name="email" type="email" placeholder="E-mail do participante" required />
                    <input name="password" type="password" placeholder="Senha inicial" required />
                    <div className="modal-actions">
                      <button type="button" className="ghost" onClick={() => setParticipantModalOpen(false)}>Cancelar</button>
                      <button type="submit">Adicionar</button>
                    </div>
                  </form>
                </section>
              </div>
            )}
          </section>
        )}

        {tab === "rounds" && isAdmin && (
          <section className="panel">
            <SectionHeader title="Rodadas" />
            <div className="round-management-list">
              {availableRounds.map((round) => {
                const isReleased = round <= activeRound;
                const isAutomatic = round <= automaticRound;
                const roundMatches = state.matches.filter((m) => getMatchRound(m) === round);
                const isManuallyLocked = roundMatches.length > 0 && roundMatches.every((m) => m.locked);
                return (
                  <div className="round-management-row" key={round}>
                    <div className="round-management-info">
                      <strong>Rodada {round}</strong>
                      <span className={`round-status-label${isManuallyLocked ? " locked" : isReleased ? " released" : ""}`}>
                        {isManuallyLocked
                          ? "Travada manualmente"
                          : isAutomatic
                          ? "Liberada automaticamente"
                          : isReleased
                          ? "Liberada manualmente"
                          : "Aguardando liberação"}
                      </span>
                    </div>
                    <div className="round-management-actions">
                      {!isReleased && (
                        <button type="button" onClick={() => releasePredictionRound(round)}>
                          Liberar rodada {round}
                        </button>
                      )}
                      {isReleased && !isManuallyLocked && (
                        <button type="button" className="ghost danger" onClick={() => lockRound(round)}>
                          Travar rodada {round}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className={`sync-strip ${sharedStatus.state}`}>
              <strong>{sharedStatus.message}</strong>
              <span>Rodada atual para palpites: {activeRound}</span>
            </div>
          </section>
        )}

        {tab === "audit" && (
          <section className="panel">
            <SectionHeader title="Auditoria" caption={`${state.auditLogs?.length ?? 0} / ${AUDIT_LOG_LIMIT} registros`} />
            <AuditLogPanel logs={state.auditLogs} />
          </section>
        )}

        {tab === "predictions" && (
          <section className="panel">
            <SectionHeader title="Palpites" />
            <div className="prediction-toolbar single">
              <label className="select-label">
                Rodada
                <select value={activePredictionRound} onChange={(event) => {
                  setSelectedPredictionRound(Number(event.target.value));
                }}>
                  {availableRounds.map((round) => (
                    <option value={round} key={round}>
                      {round < automaticRound
                        ? `Rodada ${round} - Encerrada`
                        : round <= activeRound
                        ? `Rodada ${round} - Liberada`
                        : `Rodada ${round} - Pendente`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="sync-strip">
              <strong>Regra de votação</strong>
              <span>A votação fica aberta para a rodada liberada, e cada palpite pode ser alterado até o início do jogo. Quando todos os jogos da rodada forem finalizados, a próxima rodada será liberada automaticamente.</span>
            </div>
            {activePredictionRound > activeRound && (
              <div className="sync-strip loading">
                <strong>
                  Rodada {activePredictionRound} ainda não está liberada. Aguarde a conclusão da Rodada {activeRound}.
                </strong>
              </div>
            )}
            {activeParticipant ? (
              <div className="match-list">
                {predictionMatches.map((match) => {
                  const storedPrediction = state.predictions[activeParticipant.id]?.[match.id] ?? emptyPrediction;
                  const prediction = getDraftPrediction(activeParticipant.id, match.id, storedPrediction);
                  const isSaved = hasPrediction(storedPrediction);
                  const isRoundLocked = activePredictionRound > activeRound;
                  const isKickoffLocked = isMatchClosed(match, clockNow);
                  const isLocked = isRoundLocked || isKickoffLocked;
                  return (
                    <article
                      className={`match-card prediction-card ${isLocked ? "locked" : ""}`}
                      key={match.id}
                    >
                      <div className="prediction-card-vote">
                        <div className="prediction-match-info">
                          <span className="badge">{match.phase}</span>
                          <div className="prediction-teams-grid">
                            <PredictionTeamColumn teamId={match.homeTeamId} fallback={match.home} onHistory={setHistoryTeamId} />
                            <span className="prediction-versus">x</span>
                            <PredictionTeamColumn teamId={match.awayTeamId} fallback={match.away} onHistory={setHistoryTeamId} />
                          </div>
                          <p>{formatDate(match.date)}</p>
                          <p className="match-location">{formatVenue(match)}</p>
                        </div>
                        <div className="prediction-actions">
                          <div className="prediction-inputs">
                            <ScoreInput disabled={isLocked} value={prediction.home} onChange={(value) => updateDraftPrediction(activeParticipant.id, match.id, "home", value)} />
                            <span>x</span>
                            <ScoreInput disabled={isLocked} value={prediction.away} onChange={(value) => updateDraftPrediction(activeParticipant.id, match.id, "away", value)} />
                          </div>
                          <div className="prediction-action-row">
                            {isRoundLocked ? (
                              <span className="round-locked-pill">Indisponível</span>
                            ) : isKickoffLocked ? (
                              <span className="round-locked-pill">Prazo encerrado</span>
                            ) : (
                              <button type="button" className="subtle" onClick={() => savePrediction(activeParticipant.id, match.id)}>
                                {isSaved ? "Atualizar palpite" : "Salvar palpite"}
                              </button>
                            )}
                            {isSaved && !isLocked && <span className="saved-pill">Palpite salvo</span>}
                          </div>
                        </div>
                      </div>
                      <MatchPredictionOverview
                        match={match}
                        participants={contestParticipants.filter((participant) => participant.id !== activeParticipant.id)}
                        predictions={state.predictions}
                      />
                    </article>
                  );
                })}
                {!predictionMatches.length && <EmptyState text="Nenhum jogo cadastrado para esta rodada." />}
              </div>
            ) : (
              <EmptyState text="Seu cadastro entra como participante para registrar palpites." />
            )}
          </section>
        )}

        {tab === "results" && (
          <section className="panel">
            <SectionHeader title="Resultados dos Jogos" />
            <div className={`sync-strip ${syncStatus.state}`}>
              <strong>{syncStatus.message}</strong>
              <span>{state.lastResultSyncAt ? `Última checagem: ${formatDate(state.lastResultSyncAt)}. ${resultSyncIntervalText}` : resultSyncIntervalText}</span>
            </div>
            <div className="prediction-toolbar">
              <label className="select-label">
                Rodada
                <select value={activeResultRound} onChange={(event) => {
                  setSelectedResultRound(Number(event.target.value));
                }}>
                  {availableRounds.map((round) => (
                    <option value={round} key={round}>
                      {round < automaticRound
                        ? `Rodada ${round} - Encerrada`
                        : round === automaticRound
                        ? `Rodada ${round} - Em andamento`
                        : `Rodada ${round} - Pendente`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <ResultsList matches={resultMatches} />
          </section>
        )}

        {tab === "groups" && <GroupStandingsBoard groups={groupStandings} />}

        {tab === "ranking" && <RankingTable ranking={ranking} matches={state.matches} />}
      </section>
    </main>
  );
}

function AuthScreen({ error, onLogin, onRegister }) {
  const [mode, setMode] = useState("login");
  async function handleSubmit(event) {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    await (mode === "register" ? onRegister(payload) : onLogin(payload));
  }
  return (
    <main className="auth-page">
      <section className="auth-visual">
        <img
          src={`${import.meta.env.BASE_URL}capa-bolao-login.png`}
          alt="Bolão da Copa do Mundo 2026"
          fetchPriority="high"
        />
      </section>
      <section className="auth-card">
        <div className="auth-card-header">
          <img src={AUTH_LOGO_URL} alt="Bolão da Copa" className="auth-logo" />
          <span>Copa do Mundo 2026</span>
          <h2>{mode === "register" ? "Criar sua conta" : "Entrar no bolão"}</h2>
          <p>{mode === "register" ? "Seu cadastro já entra como participante." : "Use seu e-mail e senha cadastrados."}</p>
        </div>
        <div className="mode-switch" role="tablist" aria-label="Acesso">
          <button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>Criar conta</button>
          <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Entrar</button>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === "register" && <input name="firstName" placeholder="Nome" autoComplete="given-name" />}
          {mode === "register" && <input name="lastName" placeholder="Sobrenome" autoComplete="family-name" />}
          <input name="email" type="email" placeholder="E-mail" autoComplete="email" />
          <input name="password" type="password" placeholder="Senha" autoComplete="current-password" />
          {error && <p className="form-error">{error}</p>}
          <button type="submit">{mode === "register" ? "Cadastrar e entrar" : "Entrar"}</button>
        </form>
        <p className="auth-note">Dados sincronizados entre todos os participantes em tempo real.</p>
      </section>
    </main>
  );
}

function RoundSelect({ name, value, defaultValue = "", onChange, label }) {
  const selectProps = value === undefined ? { defaultValue } : { value, onChange };
  return (
    <label className="select-shell">
      <span>{label}</span>
      <select name={name} {...selectProps}>
        {defaultRounds.map((round) => (
          <option value={round} key={round}>Rodada {round}</option>
        ))}
      </select>
    </label>
  );
}

function TeamName({ teamId, fallback }) {
  const team = teamsById[teamId];
  if (!team) return <>{fallback ?? "Seleção a definir"}</>;
  return <span className="team-name"><Flag team={team} />{team.name}</span>;
}

function PredictionTeamColumn({ teamId, fallback, onHistory }) {
  const team = teamsById[teamId];
  return (
    <div className="prediction-team-column">
      <TeamName teamId={teamId} fallback={fallback} />
      {team && (
        <button type="button" className="ghost history-button" onClick={() => onHistory(teamId)}>
          Histórico
        </button>
      )}
    </div>
  );
}

function TeamHistoryModal({ team, matches, onClose }) {
  const teamMatches = (matches ?? [])
    .filter((match) => match.homeTeamId === team.id || match.awayTeamId === team.id)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal-card team-history-modal" role="dialog" aria-modal="true" aria-labelledby="team-history-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Histórico</p>
            <h2 id="team-history-title"><TeamName teamId={team.id} fallback={team.name} /></h2>
          </div>
          <button type="button" className="modal-close" aria-label="Fechar modal" onClick={onClose}>x</button>
        </div>
        {teamMatches.length ? (
          <div className="team-history-list">
            {teamMatches.map((match) => (
              <article className="team-history-item" key={match.id}>
                <div>
                  <span className="badge">{match.phase}</span>
                  <h3 className="teams-versus">
                    <TeamName teamId={match.homeTeamId} fallback={match.home} />
                    <span>x</span>
                    <TeamName teamId={match.awayTeamId} fallback={match.away} />
                  </h3>
                  <p>{formatDate(match.date)}</p>
                  <p className="match-location">{formatVenue(match)}</p>
                </div>
                <strong className="team-history-score">{formatMatchScore(match)}</strong>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState text="Nenhum jogo encontrado para esta seleção." />
        )}
      </section>
    </div>
  );
}

function Flag({ team }) {
  return <img className="flag" src={getFlagUrl(team)} alt={`Bandeira: ${team.name}`} loading="lazy" />;
}

function SectionHeader({ title, caption }) {
  return <header className="section-header"><h2>{title}</h2><p>{caption}</p></header>;
}

function ScoreInput({ value, onChange, disabled = false }) {
  return <input className="score-input" disabled={disabled} min="0" inputMode="numeric" type="number" value={value} onChange={(event) => onChange(event.target.value)} placeholder="0" />;
}

function ParticipantGrid({ title, rows, emptyText, onChange, onResetPassword, onRemove, canRemove = true, removeLabel = "Remover", protectedUserId = "" }) {
  const [editingRow, setEditingRow] = useState(null);
  const [draft, setDraft] = useState({ name: "", email: "", password: "" });

  function startEdit(row) {
    setEditingRow(row);
    setDraft({ name: row.name ?? "", email: row.email ?? "", password: "" });
  }

  function cancelEdit() {
    setEditingRow(null);
    setDraft({ name: "", email: "", password: "" });
  }

  async function saveEdit(event) {
    event.preventDefault();
    const name = draft.name.trim();
    const email = draft.email.trim().toLowerCase();
    const password = draft.password.trim();
    if (name && name !== editingRow.name) onChange(editingRow, "name", name);
    if (email && email !== editingRow.email) onChange(editingRow, "email", email);
    if (editingRow.linkedUser && password) await onResetPassword(editingRow.userId, password);
    cancelEdit();
  }

  const isProtected = editingRow && editingRow.userId && editingRow.userId === protectedUserId;

  return (
    <section className="participant-section">
      <div className="participant-section-title">
        <h3>{title}</h3>
        <span>{rows.length} registro{rows.length === 1 ? "" : "s"}</span>
      </div>
      {rows.length ? (
        <div className="participant-grid">
          <div className="participant-grid-header">
            <span>Nome</span>
            <span>E-mail</span>
            <span>Perfil</span>
            <span>Ações</span>
          </div>
          {rows.map((row) => {
            const key = `${row.userId || "orphan"}-${row.participantId || row.id}`;
            const isCurrentUser = row.userId && row.userId === protectedUserId;
            return (
              <div className={`participant-grid-row${row.orphan ? " orphan" : ""}`} key={key}>
                <div className="participant-grid-cell">
                  <strong>{row.name || "Sem nome"}</strong>
                </div>
                <div className="participant-grid-cell">
                  <span>{row.email || "Sem e-mail vinculado"}</span>
                </div>
                <div className="participant-grid-cell">
                  {isCurrentUser ? (
                    <span className="current-user-pill">Usuário atual</span>
                  ) : (
                    <span className="participant-role-pill">{row.linkedUser ? "Participante" : "Sem acesso"}</span>
                  )}
                </div>
                <div className="list-row-actions">
                  <button type="button" className="ghost subtle" onClick={() => startEdit(row)}>Editar</button>
                  {canRemove && !isCurrentUser && (
                    <button
                      type="button"
                      className="ghost subtle icon-btn"
                      aria-label={removeLabel}
                      title={removeLabel}
                      onClick={() => onRemove(row)}
                    >
                      <FontAwesomeIcon icon={faTrash} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState text={emptyText} />
      )}

      {editingRow && (
        <div className="modal-backdrop" role="presentation" onMouseDown={cancelEdit}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="participant-edit-title" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Participantes</p>
                <h2 id="participant-edit-title">Editar contato</h2>
              </div>
              <button type="button" className="modal-close" aria-label="Fechar modal" onClick={cancelEdit}>×</button>
            </div>
            <form className="modal-form" onSubmit={saveEdit}>
              <label className="form-field">
                Nome
                <input value={draft.name} placeholder="Nome" onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
              </label>
              <label className="form-field">
                E-mail
                <input type="email" value={draft.email} placeholder="E-mail" onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} />
              </label>
              <label className="form-field">
                Nova senha
                <input
                  type="password"
                  value={draft.password}
                  disabled={!editingRow.linkedUser}
                  placeholder={editingRow.linkedUser ? "Preencha para alterar" : "Sem usuário vinculado"}
                  onChange={(e) => setDraft((d) => ({ ...d, password: e.target.value }))}
                />
              </label>
              <div className="modal-actions">
                {!isProtected && canRemove && (
                  <button type="button" className="ghost danger subtle icon-btn" aria-label={removeLabel} title={removeLabel} onClick={() => { onRemove(editingRow); cancelEdit(); }}>
                    <FontAwesomeIcon icon={faTrash} />
                  </button>
                )}
                <button type="button" className="ghost" onClick={cancelEdit}>Cancelar</button>
                <button type="submit">Salvar alterações</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}

function RankingTable({ ranking, matches = [], compact = false }) {
  const paidParticipants = ranking.length;
  const totalPoolValue = paidParticipants * ENTRY_FEE;

  return (
    <section className="panel table-panel">
      <SectionHeader title={compact ? "Top 5" : "Ranking"} />
      {!compact && (
        <div className="ranking-summary">
          <div>
            <span>Valor por participante</span>
            <strong>{formatCurrency(ENTRY_FEE)}</strong>
          </div>
          <div>
            <span>Apostadores</span>
            <strong>{paidParticipants}</strong>
          </div>
          <div>
            <span>Total arrecadado</span>
            <strong>{formatCurrency(totalPoolValue)}</strong>
          </div>
          <p>O valor acumulado será debitado para o ganhador ao final do campeonato.</p>
        </div>
      )}
      {!compact && <ScoringExamples />}
      {!compact && <RankingTiebreakerCard />}
      {ranking.length ? (
        <div className="table-wrap">
          <table className="ranking-table">
            <thead><tr><th>Colocação</th><th>Participante</th><th>Pontos</th><th>Cravados</th><th>Acertos 1 pt</th><th>Jogos pontuados</th></tr></thead>
            <tbody>
              {ranking.map((participant, index) => (
                <tr key={participant.id}>
                  <td>
                    <span className={`rank-position ${index === 0 ? "rank-position-leader" : ""}`}>
                      {index === 0 ? <FontAwesomeIcon icon={faTrophy} title="Primeiro colocado" /> : index + 1}
                    </span>
                  </td>
                  <td className="participant-cell">{participant.name}</td>
                  <td><strong className="points-pill">{participant.total}</strong></td>
                  <td>{participant.exactScores}</td>
                  <td>{participant.winnerHits}</td>
                  <td>{participant.scoredMatches}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyState text="O ranking aparece quando houver participantes cadastrados." />}
    </section>
  );
}

function ResultsList({ matches }) {
  if (!matches.length) return <EmptyState text="Nenhum jogo cadastrado para este dia." />;
  const [openMatchId, setOpenMatchId] = useState("");

  useEffect(() => {
    if (!matches.length) {
      setOpenMatchId("");
      return;
    }
    if (!openMatchId) return;
    if (matches.some((match) => match.id === openMatchId)) return;
    setOpenMatchId("");
  }, [matches, openMatchId]);

  return (
    <div className="match-list results-list">
      {matches.map((match) => (
        <ResultCard
          key={match.id}
          match={match}
          isOpen={openMatchId === match.id}
          onToggle={() => setOpenMatchId((current) => current === match.id ? "" : match.id)}
        />
      ))}
    </div>
  );
}

function getResultMeta(match) {
  const homeScore = match.homeScore === "" || match.homeScore === undefined ? null : Number(match.homeScore);
  const awayScore = match.awayScore === "" || match.awayScore === undefined ? null : Number(match.awayScore);
  const hasResult = Number.isInteger(homeScore) && Number.isInteger(awayScore);
  const homeWon = hasResult && homeScore > awayScore;
  const awayWon = hasResult && awayScore > homeScore;
  const isLive = !hasResult && isMatchClosed(match);
  return {
    homeScore,
    awayScore,
    hasResult,
    homeWon,
    awayWon,
    isLive,
    statusLabel: hasResult ? "Resultado atualizado" : isLive ? "Em andamento" : "Aguardando resultado",
    statusClass: hasResult ? "finished" : isLive ? "live" : "pending"
  };
}

function ResultCard({ match, isOpen, onToggle }) {
  const {
    homeScore,
    awayScore,
    statusLabel,
    statusClass
  } = getResultMeta(match);

  return (
    <article
      className={`match-card result-card result-accordion ${statusClass} ${isOpen ? "open" : ""}`}
    >
      <button type="button" className="result-accordion-toggle" onClick={onToggle} aria-expanded={isOpen}>
        <div className="result-card-header">
          <div>
            <span className="badge">{match.phase}</span>
            <h3 className="teams-versus">
              <TeamName teamId={match.homeTeamId} fallback={match.home} /> <span>x</span>{" "}
              <TeamName teamId={match.awayTeamId} fallback={match.away} />
            </h3>
            <p>{formatDate(match.date)}</p>
            <p className="match-location">{formatVenue(match)}</p>
          </div>
          <div className="result-card-summary">
            <div className="result-accordion-score">
              <strong>{homeScore === null ? "-" : homeScore}</strong>
              <span>x</span>
              <strong>{awayScore === null ? "-" : awayScore}</strong>
            </div>
            <span className={`result-status ${statusClass}`}>
              {statusLabel}
            </span>
            <span className="result-accordion-icon" aria-hidden="true">{isOpen ? "-" : "+"}</span>
          </div>
        </div>
      </button>
      {isOpen && (
        <div className="result-accordion-body">
          <ResultGoals match={match} />
        </div>
      )}
    </article>
  );
}

function ResultGoals({ match }) {
  const homeGoals = match.homeGoals ?? [];
  const awayGoals = match.awayGoals ?? [];
  return (
    <div className="result-goals">
      <GoalList teamId={match.homeTeamId} fallback={match.home} goals={homeGoals} />
      <GoalList teamId={match.awayTeamId} fallback={match.away} goals={awayGoals} />
    </div>
  );
}

function GoalList({ teamId, fallback, goals }) {
  const teamName = teamsById[teamId]?.name ?? fallback ?? "Seleção";
  return (
    <div className="goal-list">
      <div className="goal-list-title">{teamName}</div>
      {goals.length ? (
        <ul>
          {goals.map((goal, index) => (
            <li key={`${goal.name}-${goal.minute}-${index}`}>
              <div className="goal-player">
                <span className="goal-minute">{formatGoalMinute(goal)}</span>
                <strong>{goal.name}</strong>
              </div>
              <div className="goal-tags">
                {goal.penalty && <span className="goal-tag">Pênalti</span>}
                {goal.ownGoal && <span className="goal-tag">Contra</span>}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p>Sem gols.</p>
      )}
    </div>
  );
}

function calculateGroupStandings(matches) {
  const groups = getTeamsByGroup();
  const standingsByGroup = Object.fromEntries(
    Object.entries(groups).map(([group, teams]) => [
      group,
      teams.map((team) => ({
        teamId: team.id,
        name: team.name,
        points: 0,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDiff: 0
      }))
    ])
  );

  for (const match of matches) {
    const homeTeam = teamsById[match.homeTeamId];
    const awayTeam = teamsById[match.awayTeamId];
    if (!homeTeam || !awayTeam || homeTeam.group !== awayTeam.group) continue;

    const homeScore = parseScoreValue(match.homeScore);
    const awayScore = parseScoreValue(match.awayScore);
    if (homeScore === null || awayScore === null) continue;

    const groupRows = standingsByGroup[homeTeam.group];
    const homeRow = groupRows.find((row) => row.teamId === homeTeam.id);
    const awayRow = groupRows.find((row) => row.teamId === awayTeam.id);
    if (!homeRow || !awayRow) continue;

    homeRow.played += 1;
    awayRow.played += 1;
    homeRow.goalsFor += homeScore;
    homeRow.goalsAgainst += awayScore;
    awayRow.goalsFor += awayScore;
    awayRow.goalsAgainst += homeScore;

    if (homeScore > awayScore) {
      homeRow.wins += 1;
      awayRow.losses += 1;
      homeRow.points += 3;
    } else if (homeScore < awayScore) {
      awayRow.wins += 1;
      homeRow.losses += 1;
      awayRow.points += 3;
    } else {
      homeRow.draws += 1;
      awayRow.draws += 1;
      homeRow.points += 1;
      awayRow.points += 1;
    }
  }

  return Object.entries(standingsByGroup).map(([group, rows]) => ({
    group,
    rows: rows
      .map((row) => ({ ...row, goalDiff: row.goalsFor - row.goalsAgainst }))
      .sort((a, b) =>
        b.points - a.points ||
        b.goalDiff - a.goalDiff ||
        b.goalsFor - a.goalsFor ||
        b.wins - a.wins ||
        a.name.localeCompare(b.name)
      )
  }));
}

function MatchPredictionOverview({ match, participants, predictions }) {
  const offeredPredictions = participants
    .map((participant) => ({ participant, prediction: predictions[participant.id]?.[match.id] }))
    .filter(({ prediction }) => hasPrediction(prediction));

  return (
    <div className="prediction-card-overview">
      <div className="prediction-card-overview-header">
        <strong>Palpites dos participantes</strong>
        <span>{offeredPredictions.length} palpite{offeredPredictions.length === 1 ? "" : "s"}</span>
      </div>
      {offeredPredictions.length ? (
        <div className="table-wrap">
          <table className="compact-table">
            <thead><tr><th>Participante</th><th>Palpite</th></tr></thead>
            <tbody>
              {offeredPredictions.map(({ participant, prediction }) => (
                <tr key={participant.id}>
                  <td>{participant.name}</td>
                  <td><span className="prediction-pill">{formatPrediction(prediction)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">Nenhum palpite registrado para este jogo.</p>
      )}
    </div>
  );
}

function hasPrediction(prediction) {
  return Boolean(prediction && prediction.home !== "" && prediction.away !== "");
}

function formatPrediction(prediction) {
  if (!prediction || prediction.home === "" || prediction.away === "") return "Sem palpite";
  return `${prediction.home} x ${prediction.away}`;
}

function formatMatchScore(match) {
  const home = parseScoreValue(match?.homeScore);
  const away = parseScoreValue(match?.awayScore);
  return home === null || away === null ? "Aguardando" : `${home} x ${away}`;
}

function formatGoalMinute(goal) {
  if (goal.minute === "" || goal.minute === null || goal.minute === undefined) return "-";
  return goal.offset ? `${goal.minute}+${goal.offset}'` : `${goal.minute}'`;
}

function ScoringExamples() {
  return (
    <div className="scoring-examples">
      <div className="scoring-card scoring-card-primary">
        <div className="scoring-card-header">
          <strong>3</strong>
          <span>pontos</span>
        </div>
        <div className="scoring-card-copy">
          <strong>Placar cravado</strong>
          <span>Palpite 2 x 1, resultado 2 x 1.</span>
        </div>
      </div>
      <div className="scoring-card">
        <div className="scoring-card-header">
          <strong>1</strong>
          <span>ponto</span>
        </div>
        <div className="scoring-card-copy">
          <strong>Vencedor correto</strong>
          <span>Acertou quem venceu, mesmo sem cravar o placar.</span>
        </div>
      </div>
      <div className="scoring-card">
        <div className="scoring-card-header">
          <strong>1</strong>
          <span>ponto</span>
        </div>
        <div className="scoring-card-copy">
          <strong>Empate correto</strong>
          <span>Palpite e resultado foram empate, com placar diferente.</span>
        </div>
      </div>
      <div className="scoring-card scoring-card-muted">
        <div className="scoring-card-header">
          <strong>0</strong>
          <span>ponto</span>
        </div>
        <div className="scoring-card-copy">
          <strong>Resultado errado</strong>
          <span>Errou o vencedor ou marcou empate quando houve vencedor.</span>
        </div>
      </div>
    </div>
  );
}

function RankingTiebreakerCard() {
  return (
    <div className="ranking-tiebreaker-card">
      <div className="ranking-tiebreaker-heading">
        <span>Critérios de desempate</span>
        <strong>Se houver empate na pontuação final</strong>
      </div>
      <ol>
        <li><strong>1</strong><span>Maior número de placares cravados.</span></li>
        <li><strong>2</strong><span>Maior número de acertos de 1 ponto.</span></li>
        <li><strong>3</strong><span>Persistindo o empate, prevalece a ordem alfabética.</span></li>
      </ol>
    </div>
  );
}

function GroupStandingsBoard({ groups }) {
  return (
    <section className="panel">
      <SectionHeader title="Classificação dos Grupos" />
      <div className="groups-standings-layout">
        {groups.map((group) => (
          <section className="group-standings-card" key={group.group}>
            <div className="group-standings-header">
              <span className="badge">{`Grupo ${group.group}`}</span>
            </div>
            <div className="table-wrap">
              <table className="group-standings-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Seleção</th>
                    <th>PTS</th>
                    <th>J</th>
                    <th>V</th>
                    <th>E</th>
                    <th>D</th>
                    <th>GP</th>
                    <th>GC</th>
                    <th>SG</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row, index) => (
                    <tr key={row.teamId} className={index < 2 ? "qualified" : ""}>
                      <td><span className="rank-position">{index + 1}</span></td>
                      <td className="group-team-cell"><TeamName teamId={row.teamId} fallback={row.name} /></td>
                      <td><strong>{row.points}</strong></td>
                      <td>{row.played}</td>
                      <td>{row.wins}</td>
                      <td>{row.draws}</td>
                      <td>{row.losses}</td>
                      <td>{row.goalsFor}</td>
                      <td>{row.goalsAgainst}</td>
                      <td>{row.goalDiff}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

function EmptyState({ text }) {
  return <p className="empty">{text}</p>;
}

const AUDIT_ACTION_LABELS = {
  prediction_saved: "Palpite salvo",
  user_registered: "Usuário cadastrado",
  participant_added: "Participante adicionado",
  participant_removed: "Participante removido",
  password_reset: "Senha redefinida",
  match_added: "Jogo adicionado",
  match_removed: "Jogo removido",
  results_synced: "Resultados sincronizados",
  data_reset: "Dados reiniciados",
  round_released: "Rodada liberada",
  round_locked: "Rodada travada"
};

const AUDIT_ACTION_CLASS = {
  prediction_saved: "info",
  user_registered: "info",
  participant_added: "info",
  participant_removed: "danger",
  password_reset: "warning",
  match_added: "info",
  match_removed: "danger",
  results_synced: "success",
  data_reset: "danger",
  round_released: "success",
  round_locked: "warning"
};

function AuditLogPanel({ logs }) {
  const [filter, setFilter] = useState("all");
  const allLogs = logs ?? [];
  const filtered = filter === "all" ? allLogs : allLogs.filter((log) => log.action === filter);
  const actionCounts = allLogs.reduce((acc, log) => {
    acc[log.action] = (acc[log.action] ?? 0) + 1;
    return acc;
  }, {});

  if (!allLogs.length) {
    return (
      <div className="sync-strip">
        <strong>Nenhuma ação registrada ainda.</strong>
        <span>Os logs passarão a ser registrados a partir desta sessão.</span>
      </div>
    );
  }

  return (
    <>
      <div className="audit-filter-bar">
        <label className="select-label">
          Filtrar por ação
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">Todas ({allLogs.length})</option>
            {Object.entries(AUDIT_ACTION_LABELS).map(([key, label]) => {
              const count = actionCounts[key] ?? 0;
              if (!count) return null;
              return <option key={key} value={key}>{label} ({count})</option>;
            })}
          </select>
        </label>
        <p className="audit-count">{filtered.length} registro{filtered.length === 1 ? "" : "s"}</p>
      </div>
      <div className="audit-log-list">
        {filtered.map((log) => {
          const cls = AUDIT_ACTION_CLASS[log.action] ?? "info";
          return (
            <div className={`audit-log-entry audit-log-${cls}`} key={log.id ?? log.createdAt}>
              <span className="audit-log-time">{formatDate(log.createdAt)}</span>
              <div className="audit-log-body">
                <div className="audit-log-header">
                  <span className="audit-log-actor">{log.actor}</span>
                  <span className={`audit-log-badge audit-badge-${cls}`}>
                    {AUDIT_ACTION_LABELS[log.action] ?? log.action}
                  </span>
                </div>
                {log.details && <p className="audit-log-details">{log.details}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function formatDate(value) {
  if (!value) return "Data a definir";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatVenue(match) {
  const city = [match.city, match.country].filter(Boolean).join(", ");
  const stadium = match.stadium || match.ground;
  if (!city && !stadium) return "Local a definir";
  if (!city) return stadium;
  if (!stadium) return city;
  return `${stadium} - ${city}`;
}

function formatShortTime(value) {
  return new Intl.DateTimeFormat("pt-BR", { timeStyle: "short" }).format(value);
}

const rootElement = document.getElementById("root");
const root = globalThis.__bolaoRoot ?? createRoot(rootElement);
globalThis.__bolaoRoot = root;
root.render(<App />);
