import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  calculateRanking,
  createInitialState,
  emptyPrediction,
  getActiveRound,
  getMatchRound,
  isMatchClosed,
  isSuperAdminEmail,
  makeId,
  normalizeEmailList,
  normalizeUsers,
  purgeClearedOpeningPredictions,
  purgeExpiredPredictions,
  purgeFutureRoundPredictions
} from "./domain.js";
import { getFlagUrl, teamsById } from "./teams.js";
import { attachPasswordCredential, hasLegacyPassword, verifyPassword } from "./passwords.js";
import { applyResultUpdates, fetchWorldCupResults } from "./resultsSync.js";
import {
  fetchPoolState,
  mergePublicPoolState,
  persistPoolState,
  subscribeToPoolChanges,
  unsubscribeFromPoolChanges
} from "./sharedState.js";
import "./styles.css";

const ACTIVE_POOL_ID = import.meta.env.VITE_POOL_ID || "copa-2026";
const STORAGE_SCOPE = ACTIVE_POOL_ID === "copa-2026" ? "" : `:${ACTIVE_POOL_ID}`;
const SESSION_KEY = `bolao-copa-2026${STORAGE_SCOPE}:session`;
const CACHE_KEY = `bolao-copa-2026${STORAGE_SCOPE}:cache`;
const LEGACY_DATA_KEY = "bolao-copa-2026:v1";
const DATA_LOAD_TIMEOUT_MS = 7000;
const DEFAULT_SUPER_ADMIN_EMAIL = "guilhermesaraiva25@gmail.com,guilhermesaraiva.rocha@hotmail.com";
const ENTRY_FEE = 20;
const SIDEMENU_LOGO_URL = `${import.meta.env.BASE_URL}sidemenu-logo.png`;
const WORLD_CUP_LOGO_URL =
  "https://upload.wikimedia.org/wikipedia/commons/a/ab/2026_FIFA_World_Cup_emblem_%28horizontal_lockup%29.svg";
const SUPER_ADMIN_EMAILS = normalizeEmailList(
  `${import.meta.env.VITE_SUPER_ADMIN_EMAILS ?? ""},${import.meta.env.VITE_SUPER_ADMIN_EMAIL ?? DEFAULT_SUPER_ADMIN_EMAIL}`
);

function loadSession() {
  try {
    const saved = localStorage.getItem(SESSION_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

function saveSession(updates) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ ...loadSession(), ...updates }));
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
      matches: state.matches ?? [],
      lastResultSyncAt: state.lastResultSyncAt ?? "",
      deletedUserIds: state.deletedUserIds ?? [],
      deletedParticipantIds: state.deletedParticipantIds ?? []
    }));
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
  { id: "dailyPredictions", label: "Palpites do Dia" },
  { id: "results", label: "Resultados" },
  { id: "ranking", label: "Ranking" }
];

const adminTabs = [
  { id: "participants", label: "Participantes" },
  ...userTabs
];

const defaultRounds = [1, 2, 3];

function applyRemoteData(current, remoteData, superAdminEmails, { prefer = "shared" } = {}) {
  const merged = mergePublicPoolState(current, remoteData, { prefer });
  return cleanPoolState({
    ...merged,
    users: normalizeUsers(merged.users ?? [], superAdminEmails),
    currentUserId: current.currentUserId,
    activeParticipantId: current.activeParticipantId
  });
}

function cleanPoolState(state) {
  return purgeClearedOpeningPredictions(purgeExpiredPredictions(purgeFutureRoundPredictions(state)));
}

function App() {
  const [state, setState] = useState(createInitialState);
  const [isLoading, setIsLoading] = useState(true);
  const [tab, setTab] = useState("predictions");
  const [authError, setAuthError] = useState("");
  const [syncStatus, setSyncStatus] = useState({ state: "idle", message: "Resultados automáticos ativos." });
  const [sharedStatus, setSharedStatus] = useState({ state: "idle", message: "Carregando dados do bolão..." });
  const [selectedPredictionRound, setSelectedPredictionRound] = useState(null);
  const [selectedOverviewRound, setSelectedOverviewRound] = useState(null);
  const [selectedResultRound, setSelectedResultRound] = useState(null);
  const [draftPredictions, setDraftPredictions] = useState({});
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [participantModalOpen, setParticipantModalOpen] = useState(false);
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const [clockNow, setClockNow] = useState(() => new Date());
  const workspaceRef = useRef(null);

  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  const isAdmin = currentUser?.role === "admin";
  const visibleTabs = isAdmin ? adminTabs : userTabs;
  const ranking = useMemo(
    () => calculateRanking(state.participants, state.matches, state.predictions),
    [state.matches, state.participants, state.predictions]
  );
  const activeRound = useMemo(() => getActiveRound(state.matches), [state.matches]);
  const availableRounds = useMemo(() => {
    return [...new Set(
      state.matches.map((m) => getMatchRound(m)).filter((r) => r !== null && !Number.isNaN(r))
    )].sort((a, b) => a - b);
  }, [state.matches]);
  const activePredictionRound = selectedPredictionRound ?? activeRound;
  const activeOverviewRound = selectedOverviewRound ?? activeRound;
  const activeResultRound = selectedResultRound ?? activeRound;
  const predictionMatches = state.matches
    .filter((match) => getMatchRound(match) === activePredictionRound)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const overviewMatches = state.matches
    .filter((match) => getMatchRound(match) === activeOverviewRound)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const resultMatches = state.matches
    .filter((match) => getMatchRound(match) === activeResultRound)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
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

  // Initial load from Supabase (with one-time migration from legacy localStorage)
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
        const remote = await withTimeout(
          fetchPoolState(),
          DATA_LOAD_TIMEOUT_MS,
          "Tempo excedido ao carregar dados do banco."
        );

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

        // Persist if data was migrated from localStorage or expired/future predictions were purged.
        if (legacyData || cleanedBase !== base) {
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
      setState((current) => applyRemoteData(current, cleanedRemote, SUPER_ADMIN_EMAILS));
      if (cleanedRemote !== remoteData) void persistPoolState(cleanedRemote);
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
        setState((current) => applyRemoteData(current, cleanedRemote, SUPER_ADMIN_EMAILS));
        if (cleanedRemote !== remote) void persistPoolState(cleanedRemote);
      } catch {}
    }, 30_000);
    return () => window.clearInterval(intervalId);
  }, []);

  // Auto-sync results when logged in
  useEffect(() => {
    if (!currentUser) return undefined;
    syncResults("auto");
    const intervalId = window.setInterval(() => syncResults("auto"), 5 * 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, [currentUser?.id]);

  useEffect(() => {
    if (!visibleTabs.some((item) => item.id === tab)) {
      setTab("predictions");
    }
  }, [tab, visibleTabs]);

  function handleTabClick(tabId) {
    setTab(tabId);
    setMobileMenuOpen(false);
    if (tabId === "predictions" || tabId === "ranking" || tabId === "results") {
      window.requestAnimationFrame(() => {
        workspaceRef.current?.scrollTo({ top: 0, behavior: "auto" });
      });
    }
  }

  // Optimistically update state then persist to Supabase
  function updateState(recipe) {
    // Compute nextState using the current closure value of `state` so it is
    // available synchronously — React 19 batches setState callbacks lazily
    // and the updater may not run before persistAndSync needs the value.
    const nextState = typeof recipe === "function" ? recipe(state) : recipe;
    setState(nextState);
    void persistAndSync(nextState);
  }

  async function persistAndSync(nextState) {
    try {
      const saved = await persistPoolState(nextState);
      const cleanedSaved = cleanPoolState(saved);
      saveCachedPoolState(cleanedSaved);
      // prefer: "current" → local deletions and edits always win over the just-saved remote snapshot
      setState((current) => applyRemoteData(current, cleanedSaved, SUPER_ADMIN_EMAILS, { prefer: "current" }));
    } catch (error) {
      setSharedStatus({ state: "error", message: `Erro ao salvar: ${error.message}` });
    }
  }

  async function syncResults(mode = "manual") {
    setSyncStatus({ state: "loading", message: "Atualizando resultados..." });
    try {
      const sourceMatches = await fetchWorldCupResults();
      let changed = 0;
      updateState((current) => {
        const update = applyResultUpdates(current.matches, sourceMatches);
        changed = update.changed;
        return { ...current, matches: update.matches, lastResultSyncAt: new Date().toISOString() };
      });
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

  async function registerUser({ name, email, password }) {
    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanName || !cleanEmail || !password) {
      setAuthError("Preencha nome, e-mail e senha para criar sua conta.");
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
        role: isSuperAdminEmail(cleanEmail, SUPER_ADMIN_EMAILS) ? "admin" : "user",
        favoriteTeamId: "",
        participantId: participant.id,
        createdAt: now
      }, password);
    } catch (error) {
      setAuthError(error.message);
      return;
    }

    saveSession({ currentUserId: user.id, activeParticipantId: participant.id });
    updateState((current) => ({
      ...current,
      users: [...current.users, user],
      participants: [...current.participants, participant],
      currentUserId: user.id,
      activeParticipantId: participant.id
    }));
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
    updateState((current) => {
      return {
        ...current,
        users: [...current.users, user],
        participants: [...current.participants, participant],
        activeParticipantId: current.activeParticipantId || participant.id
      };
    });
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

      return {
        ...current,
        users,
        participants,
        predictions,
        deletedUserIds: [...new Set([...(current.deletedUserIds ?? []), ...userIdsToRemove])],
        deletedParticipantIds: [...new Set([...(current.deletedParticipantIds ?? []), ...participantIdsToRemove])],
        activeParticipantId: participantIdsToRemove.has(current.activeParticipantId)
          ? participants[0]?.id ?? ""
          : current.activeParticipantId
      };
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
    updateState((current) => ({ ...current, matches: [...current.matches, match] }));
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
      const predictions = Object.fromEntries(
        Object.entries(current.predictions).map(([participantId, participantPredictions]) => {
          const nextPredictions = { ...participantPredictions };
          delete nextPredictions[matchId];
          return [participantId, nextPredictions];
        })
      );
      return { ...current, matches: current.matches.filter((match) => match.id !== matchId), predictions };
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
    if (getMatchRound(match) !== activeRound || isMatchClosed(match)) return;

    const draft = getDraftPrediction(participantId, matchId, currentPrediction);
    // Treat blank input as 0 — user leaving the field empty means "zero gols"
    const normalizedDraft = {
      home: draft.home !== "" ? draft.home : "0",
      away: draft.away !== "" ? draft.away : "0",
    };

    const savedAt = new Date().toISOString();
    updateState((current) => ({
      ...current,
      predictions: {
        ...current.predictions,
        [participantId]: {
          ...current.predictions[participantId],
          [matchId]: { ...emptyPrediction, ...current.predictions[participantId]?.[matchId], ...normalizedDraft, savedAt, updatedAt: savedAt }
        }
      }
    }));
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
    updateState((current) => ({
      ...current,
      users: current.users.map((user) =>
        user.id === userId ? updatedUser : user
      )
    }));
  }

  function resetData() {
    if (!confirm("Apagar todos os dados do bolão? Esta ação não pode ser desfeita.")) return;
    updateState(createInitialState());
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
          <img src={SIDEMENU_LOGO_URL} alt="Logo FIFA World Cup 2026" />
          <button type="button" className="menu-close" aria-label="Fechar menu" onClick={() => setMobileMenuOpen(false)}>✕</button>
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
              <button type="button" className="modal-close" aria-label="Fechar modal" onClick={() => setAdminMenuOpen(false)}>✕</button>
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

      <section className="workspace" ref={workspaceRef}>
        <header className="topbar">
          <div className="topbar-left">
            <button type="button" className="hamburger" aria-label="Abrir menu" onClick={() => setMobileMenuOpen(true)}>☰</button>
            <div>
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
                    <button type="button" className="modal-close" aria-label="Fechar modal" onClick={() => setParticipantModalOpen(false)}>✕</button>
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

{tab === "predictions" && (
          <section className="panel">
            <SectionHeader title="Palpites" />
            <div className="prediction-toolbar single">
              <label className="select-label">
                Rodada
                <select value={activePredictionRound} onChange={(event) => setSelectedPredictionRound(Number(event.target.value))}>
                  {availableRounds.map((round) => (
                    <option value={round} key={round}>
                      {round === activeRound ? `Rodada ${round} - liberada` : `Rodada ${round}`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="sync-strip">
              <strong>Regra de votação</strong>
              <span>A votação fica aberta para a rodada liberada, e cada palpite pode ser alterado até o início do jogo. Quando todos os jogos da rodada forem finalizados, a próxima rodada será liberada automaticamente.</span>
            </div>
            {activePredictionRound !== activeRound && (
              <div className={`sync-strip ${activePredictionRound < activeRound ? "disabled" : "loading"}`}>
                <strong>
                  {activePredictionRound < activeRound
                    ? "Rodada encerrada - palpites não são mais aceitos."
                    : `Rodada ${activePredictionRound} ainda não está liberada. Aguarde a conclusão da Rodada ${activeRound}.`}
                </strong>
              </div>
            )}
            {activeParticipant ? (
              <div className="match-list">
                {predictionMatches.map((match) => {
                  const storedPrediction = state.predictions[activeParticipant.id]?.[match.id] ?? emptyPrediction;
                  const prediction = getDraftPrediction(activeParticipant.id, match.id, storedPrediction);
                  const isSaved = hasPrediction(storedPrediction);
                  const isRoundLocked = activePredictionRound !== activeRound;
                  const isKickoffLocked = isMatchClosed(match, clockNow);
                  const isLocked = isRoundLocked || isKickoffLocked;
                  return (
                    <article className={`match-card prediction-card ${isLocked ? "locked" : ""}`} key={match.id}>
                      <div>
                        <span className="badge">{match.phase}</span>
                        <h3 className="teams-versus"><TeamName teamId={match.homeTeamId} fallback={match.home} /> <span>x</span> <TeamName teamId={match.awayTeamId} fallback={match.away} /></h3>
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
                            <span className="round-locked-pill">
                              {activePredictionRound < activeRound ? "Sem palpite" : "Indisponível"}
                            </span>
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

        {tab === "dailyPredictions" && (
          <section className="panel">
            <SectionHeader title="Palpites do Dia" />
            <div className="prediction-toolbar single">
              <label className="select-label">
                Rodada
                <select value={activeOverviewRound} onChange={(event) => setSelectedOverviewRound(Number(event.target.value))}>
                  {availableRounds.map((round) => (
                    <option value={round} key={round}>
                      {round === activeRound ? `Rodada ${round} — em andamento` : `Rodada ${round}`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className={`sync-strip ${sharedStatus.state}`}>
              <strong>{sharedStatus.message}</strong>
              <span>Participantes, palpites, jogos e resultados são sincronizados em tempo real.</span>
            </div>
            <DailyPredictions
              matches={overviewMatches}
              participants={state.participants}
              predictions={state.predictions}
            />
          </section>
        )}

        {tab === "results" && (
          <section className="panel">
            <SectionHeader title="Resultados dos Jogos" />
            <div className={`sync-strip ${syncStatus.state}`}>
              <strong>{syncStatus.message}</strong>
              <span>{state.lastResultSyncAt ? `Última checagem: ${formatDate(state.lastResultSyncAt)}` : "A atualização roda ao entrar e a cada 5 minutos."}</span>
            </div>
            <div className="prediction-toolbar">
              <label className="select-label">
                Rodada
                <select value={activeResultRound} onChange={(event) => setSelectedResultRound(Number(event.target.value))}>
                  {availableRounds.map((round) => (
                    <option value={round} key={round}>
                      {round === activeRound ? `Rodada ${round} - em andamento` : `Rodada ${round}`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <ResultsList matches={resultMatches} />
          </section>
        )}

        {tab === "ranking" && <RankingTable ranking={ranking} />}
      </section>
    </main>
  );
}

function AuthScreen({ error, onLogin, onRegister }) {
  const [mode, setMode] = useState("register");
  async function handleSubmit(event) {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    await (mode === "register" ? onRegister(payload) : onLogin(payload));
  }
  return (
    <main className="auth-page">
      <section className="auth-visual">
        <img
          src="https://store.fifa.com/cdn/shop/files/image_217bb8c0-803c-4772-9c18-18f1e677f831.jpg?v=1780325535&width=900"
          alt="Pôster oficial da FIFA World Cup 2026"
        />
      </section>
      <section className="auth-card">
        <div className="auth-card-header">
          <span>Copa do Mundo 2026</span>
          <h1>Bolão da Copa</h1>
          <h2>{mode === "register" ? "Criar sua conta" : "Entrar no bolão"}</h2>
          <p>{mode === "register" ? "Seu cadastro já entra como participante." : "Use seu e-mail e senha cadastrados."}</p>
        </div>
        <div className="mode-switch" role="tablist" aria-label="Acesso">
          <button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>Criar conta</button>
          <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Entrar</button>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === "register" && <input name="name" placeholder="Seu nome" autoComplete="name" />}
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
            <span>Ações</span>
          </div>
          {rows.map((row) => (
            <div className={`participant-grid-row${row.orphan ? " orphan" : ""}`} key={`${row.userId || "orphan"}-${row.participantId || row.id}`}>
              <input value={row.name} placeholder="Nome" onChange={(event) => onChange(row, "name", event.target.value)} />
              <input type="email" value={row.email} placeholder="Sem e-mail vinculado" onChange={(event) => onChange(row, "email", event.target.value)} />
              <div className="list-row-actions">
                {row.linkedUser && (
                  <button type="button" className="ghost subtle" onClick={() => {
                    const nova = prompt(`Nova senha para ${row.name}:`);
                    if (nova?.trim()) onResetPassword(row.userId, nova.trim());
                  }}>Resetar senha</button>
                )}
                {row.userId && row.userId === protectedUserId ? (
                  <span className="current-user-pill">Usuário atual</span>
                ) : canRemove && (
                  <button type="button" className="danger subtle" onClick={() => onRemove(row)}>{removeLabel}</button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text={emptyText} />
      )}
    </section>
  );
}

function RankingTable({ ranking, compact = false }) {
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
      {!compact && <RankingInfoCard />}
      {ranking.length ? (
        <div className="table-wrap">
          <table className="ranking-table">
            <thead><tr><th>#</th><th>Participante</th><th>Pontos</th><th>Cravados</th><th>Acertos 1 pt</th><th>Jogos pontuados</th></tr></thead>
            <tbody>
              {ranking.map((participant, index) => (
                <tr key={participant.id}>
                  <td><span className="rank-position">{index + 1}</span></td>
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
  const preferredOpenMatchId = matches.find((match) => getResultMeta(match).hasResult)?.id ?? "";
  const [openMatchId, setOpenMatchId] = useState(preferredOpenMatchId);

  useEffect(() => {
    if (!matches.length) {
      setOpenMatchId("");
      return;
    }
    if (!openMatchId) return;
    if (matches.some((match) => match.id === openMatchId && getResultMeta(match).hasResult)) return;
    setOpenMatchId(preferredOpenMatchId);
  }, [matches, openMatchId, preferredOpenMatchId]);

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
    hasResult,
    homeWon,
    awayWon,
    statusLabel,
    statusClass
  } = getResultMeta(match);

  if (!hasResult) {
    return (
      <article className={`match-card result-card ${statusClass}`}>
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
          <span className={`result-status ${statusClass}`}>
            {statusLabel}
          </span>
        </div>
        <div className="result-board">
          <ResultTeam teamId={match.homeTeamId} fallback={match.home} score={homeScore} isWinner={homeWon} />
          <span className="result-separator">x</span>
          <ResultTeam teamId={match.awayTeamId} fallback={match.away} score={awayScore} isWinner={awayWon} align="right" />
        </div>
      </article>
    );
  }

  return (
    <article className={`match-card result-card result-accordion ${statusClass} ${isOpen ? "open" : ""}`}>
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
          <div className="result-board">
            <ResultTeam teamId={match.homeTeamId} fallback={match.home} score={homeScore} isWinner={homeWon} />
            <span className="result-separator">x</span>
            <ResultTeam teamId={match.awayTeamId} fallback={match.away} score={awayScore} isWinner={awayWon} align="right" />
          </div>
          <ResultGoals match={match} hasResult={hasResult} />
        </div>
      )}
    </article>
  );
}

function ResultTeam({ teamId, fallback, score, isWinner, align = "left" }) {
  return (
    <div className={`result-team ${isWinner ? "winner" : ""} ${align === "right" ? "right" : ""}`}>
      <TeamName teamId={teamId} fallback={fallback} />
      <strong className="result-score">{score === null ? "-" : score}</strong>
    </div>
  );
}

function ResultGoals({ match, hasResult }) {
  const homeGoals = match.homeGoals ?? [];
  const awayGoals = match.awayGoals ?? [];
  const hasGoals = homeGoals.length > 0 || awayGoals.length > 0;
  if (!hasResult) return null;
  if (!hasGoals) return <p className="result-goals-empty">Nenhum gol registrado para esta partida.</p>;
  return (
    <div className="result-goals">
      <GoalList title="Gols mandante" teamId={match.homeTeamId} fallback={match.home} goals={homeGoals} />
      <GoalList title="Gols visitante" teamId={match.awayTeamId} fallback={match.away} goals={awayGoals} align="right" />
    </div>
  );
}

function GoalList({ teamId, fallback, goals, align = "left" }) {
  return (
    <div className={`goal-list ${align === "right" ? "right" : ""}`}>
      <div className="goal-list-title"><TeamName teamId={teamId} fallback={fallback} /></div>
      {goals.length ? (
        <ul>
          {goals.map((goal, index) => (
            <li key={`${goal.name}-${goal.minute}-${index}`}>
              <span className="goal-minute">{formatGoalMinute(goal)}</span>
              <strong>{goal.name}</strong>
              {goal.penalty && <span className="goal-tag">Pênalti</span>}
              {goal.ownGoal && <span className="goal-tag">Contra</span>}
            </li>
          ))}
        </ul>
      ) : <p>Sem gols.</p>}
    </div>
  );
}

function DailyPredictions({ matches, participants, predictions }) {
  if (!matches.length) return <EmptyState text="Nenhum jogo cadastrado para este dia." />;
  if (!participants.length) return <EmptyState text="Nenhum participante cadastrado ainda." />;
  return (
    <div className="daily-predictions">
      {matches.map((match) => (
        <DailyPredictionCard key={match.id} match={match} participants={participants} predictions={predictions} />
      ))}
    </div>
  );
}

function DailyPredictionCard({ match, participants, predictions }) {
  const offeredPredictions = participants
    .map((participant) => ({ participant, prediction: predictions[participant.id]?.[match.id] }))
    .filter(({ prediction }) => hasPrediction(prediction));

  return (
    <article className="match-card daily-prediction-card">
      <div>
        <span className="badge">{match.phase}</span>
        <h3 className="teams-versus">
          <TeamName teamId={match.homeTeamId} fallback={match.home} /> <span>x</span>{" "}
          <TeamName teamId={match.awayTeamId} fallback={match.away} />
        </h3>
        <p>{formatDate(match.date)}</p>
        <p className="match-location">{formatVenue(match)}</p>
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
    </article>
  );
}

function hasPrediction(prediction) {
  return Boolean(prediction && prediction.home !== "" && prediction.away !== "");
}

function formatPrediction(prediction) {
  if (!prediction || prediction.home === "" || prediction.away === "") return "Sem palpite";
  return `${prediction.home} x ${prediction.away}`;
}

function formatGoalMinute(goal) {
  if (goal.minute === "" || goal.minute === null || goal.minute === undefined) return "-";
  return goal.offset ? `${goal.minute}+${goal.offset}'` : `${goal.minute}'`;
}

function ScoringExamples() {
  return (
    <div className="scoring-examples">
      <div><strong>3 pontos</strong><span>Cravou o placar: palpite 2 x 1, resultado 2 x 1.</span></div>
      <div><strong>1 ponto</strong><span>Acertou o ganhador ou o empate: palpite 2 x 2, resultado 1 x 1.</span></div>
      <div><strong>0 ponto</strong><span>Errou o ganhador ou indicou empate quando houve vencedor.</span></div>
    </div>
  );
}

function RankingInfoCard() {
  return (
    <div className="ranking-info-card">
      <strong>Empate também pontua</strong>
      <span>Se o palpite e o resultado forem empate, soma 1 ponto mesmo sem cravar o placar. Exemplo: palpite 2 x 2, resultado 1 x 1.</span>
    </div>
  );
}

function EmptyState({ text }) {
  return <p className="empty">{text}</p>;
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
