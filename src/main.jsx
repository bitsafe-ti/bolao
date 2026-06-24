import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEye, faTrophy, faTrash, faFutbol, faListCheck, faLayerGroup, faSitemap, faMedal, faGear, faChevronLeft, faChevronRight, faRightFromBracket, faUser, faUsers, faCalendarDays, faClipboardList } from "@fortawesome/free-solid-svg-icons";
import {
  calculateRanking,
  clearedOpeningPredictionMatchIds,
  createInitialState,
  emptyPrediction,
  getActiveRound,
  getPredictionScrollTargetId,
  getLatestResultMatchId,
  getMatchRound,
  getReleasedPredictionRound,
  hasMatchStarted,
  isMatchClosed,
  isMatchLive,
  isMatchResultFinal,
  makeId,
  normalizeUsers,
  purgeClearedOpeningPredictions,
  purgeExpiredPredictions,
  purgeFutureRoundPredictions,
  scorePrediction
} from "./domain.js";
import { getFlagUrl, getTeamsByGroup, teamsById } from "./teams.js";
import { buildRoundOf32Bracket } from "./bracket.js";
import { attachPasswordCredential, hasLegacyPassword, verifyPassword } from "./passwords.js";
import {
  fetchPoolState,
  fetchPoolStateFromPool,
  mergePublicPoolState,
  persistPoolState,
  subscribeToPoolChanges,
  unsubscribeFromPoolChanges
} from "./sharedState.js";
import { TURNSTILE_SITE_KEY, verifyTurnstileToken } from "./turnstile.js";
import "./styles.css";

const ACTIVE_POOL_ID = import.meta.env.VITE_POOL_ID || "copa-2026";
const DEFAULT_SUPER_ADMIN_EMAIL = "guilhermesaraiva25@gmail.com";
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
const PRIZE_DISTRIBUTION = [
  { label: "1º lugar", percent: 50 },
  { label: "2º lugar", percent: 30 },
  { label: "3º lugar", percent: 20 }
];
const AUTH_LOGO_URL = `${import.meta.env.BASE_URL}logo_bolao_transparente.png`;
const FAVICON_URL = `${import.meta.env.BASE_URL}gb.png`;
const TACA_URL = `${import.meta.env.BASE_URL}taca.png`;
const TACA_PRATA_URL = `${import.meta.env.BASE_URL}taca-p.png`;
const TACA_BRONZE_URL = `${import.meta.env.BASE_URL}taca-b.png`;
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
      lastResultSyncSource: state.lastResultSyncSource ?? "",
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
  { id: "predictions", label: "Palpites", icon: faFutbol },
  { id: "results", label: "Resultados", icon: faListCheck },
  { id: "groups", label: "Grupos", icon: faLayerGroup },
  { id: "bracket", label: "Chaveamento", icon: faSitemap },
  { id: "ranking", label: "Ranking", icon: faMedal }
];

const adminTabs = [
  ...userTabs,
  { id: "settings", label: "Configurações", icon: faGear }
];

const settingsTabs = [
  { id: "participants", label: "Participantes", icon: faUsers },
  { id: "rounds", label: "Rodadas", icon: faCalendarDays },
  { id: "audit", label: "Logs do sistema", icon: faClipboardList }
];

const defaultRounds = [1, 2, 3];
const AUDIT_LOG_LIMIT = 1000;

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

function maskEmail(email = "") {
  const [name = "", domain = ""] = String(email).split("@");
  if (!name || !domain) return "";
  const visible = name.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(2, name.length - 2))}@${domain}`;
}

function getUserInitials(name = "") {
  return String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "U";
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    reader.readAsDataURL(file);
  });
}

function loadProfileImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("A imagem selecionada é inválida."));
    image.src = source;
  });
}

async function resizeProfileImage(file) {
  if (!file?.type?.startsWith("image/")) throw new Error("Selecione um arquivo de imagem.");
  if (file.size > 5 * 1024 * 1024) throw new Error("A imagem deve ter no máximo 5 MB.");

  const source = await readFileAsDataUrl(file);
  const image = await loadProfileImage(source);
  const maxSize = 512;
  const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/webp", 0.82);
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
  const [tab, setTab] = useState(() => { try { return sessionStorage.getItem("bol-tab") || "predictions"; } catch { return "predictions"; } });
  const [authError, setAuthError] = useState("");
  const [syncStatus, setSyncStatus] = useState({ state: "idle", message: "Placares automáticos ativos." });
  const [sharedStatus, setSharedStatus] = useState({ state: "idle", message: "Carregando dados do bolão..." });
  const [selectedPredictionRound, setSelectedPredictionRound] = useState(null);
  const [selectedResultRound, setSelectedResultRound] = useState(null);
  const [draftPredictions, setDraftPredictions] = useState({});
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);
  const [participantModalOpen, setParticipantModalOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState(() => { try { return sessionStorage.getItem("bol-settings-tab") || "participants"; } catch { return "participants"; } });
  const [historyTeamId, setHistoryTeamId] = useState("");
  const [clockNow, setClockNow] = useState(() => new Date());
  const [predictionScrollRequest, setPredictionScrollRequest] = useState(0);
  const [resultScrollRequest, setResultScrollRequest] = useState(0);
  const workspaceRef = useRef(null);
  const predictionTargetRef = useRef(null);
  const resultTargetRef = useRef(null);
  const handledPredictionScrollRef = useRef("");
  const handledResultScrollRef = useRef("");

  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  const isAdmin = currentUser?.role === "admin";
  const userParticipant = state.participants.find((participant) => participant.id === currentUser?.participantId);
  const activeParticipant = isAdmin
    ? state.participants.find((participant) => participant.id === state.activeParticipantId) ??
      userParticipant ??
      state.participants[0]
    : userParticipant;
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
  const groupStageComplete = useMemo(
    () => state.matches.length > 0 && state.matches.every(isMatchResultFinal),
    [state.matches]
  );
  const knockoutBracket = useMemo(
    () => buildRoundOf32Bracket(groupStandings, { groupsComplete: groupStageComplete }),
    [groupStandings, groupStageComplete]
  );
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
  const predictionScrollTargetId = useMemo(
    () => getPredictionScrollTargetId(predictionMatches),
    [predictionMatches]
  );
  const resultMatches = state.matches
    .filter((match) => getMatchRound(match) === activeResultRound)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const resultScrollTargetId = useMemo(() => getLatestResultMatchId(resultMatches), [resultMatches]);
  const resultSyncIntervalText = "O servidor verifica os jogos a cada minuto e esta tela recebe os dados em até 30 segundos.";
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
        // server update and overwrites audit log entries that were just persisted.
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
    async function pollRemote() {
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
    }
    const intervalId = window.setInterval(pollRemote, 30_000);
    function handleVisibilityChange() {
      if (!document.hidden) pollRemote();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (tab !== "profile" && !visibleTabs.some((item) => item.id === tab)) {
      setTab("predictions");
      try { sessionStorage.setItem("bol-tab", "predictions"); } catch {}
    }
  }, [tab, visibleTabs]);

  useEffect(() => {
    const mobileViewport = window.matchMedia("(max-width: 860px)");
    function syncNavigationState(event) {
      if (event.matches) setSidebarCollapsed(false);
      else setMobileMenuOpen(false);
    }
    syncNavigationState(mobileViewport);
    mobileViewport.addEventListener("change", syncNavigationState);
    return () => mobileViewport.removeEventListener("change", syncNavigationState);
  }, []);

  useEffect(() => {
    if (!userMenuOpen) return;
    function handleOutside(e) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setUserMenuOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [userMenuOpen]);

  useEffect(() => {
    if (tab !== "predictions" || isLoading || !currentUser || !workspaceRef.current) return undefined;
    const requestKey = `${predictionScrollRequest}:${activePredictionRound}:${predictionScrollTargetId ?? "top"}`;
    if (handledPredictionScrollRef.current === requestKey) return undefined;
    handledPredictionScrollRef.current = requestKey;
    const frameId = window.requestAnimationFrame(() => {
      if (predictionScrollTargetId && predictionTargetRef.current) {
        predictionTargetRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        workspaceRef.current?.scrollTo({ top: 0, behavior: "auto" });
      }
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [activePredictionRound, currentUser?.id, isLoading, predictionScrollRequest, predictionScrollTargetId, tab]);

  useEffect(() => {
    if (tab !== "results" || isLoading || !currentUser || !workspaceRef.current) return undefined;
    const requestKey = `${resultScrollRequest}:${activeResultRound}`;
    if (handledResultScrollRef.current === requestKey) return undefined;
    handledResultScrollRef.current = requestKey;
    const frameId = window.requestAnimationFrame(() => {
      if (resultScrollTargetId && resultTargetRef.current) {
        resultTargetRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        workspaceRef.current?.scrollTo({ top: 0, behavior: "auto" });
      }
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [activeResultRound, currentUser?.id, isLoading, resultScrollRequest, resultScrollTargetId, tab]);


  function handleTabClick(tabId) {
    setTab(tabId);
    try { sessionStorage.setItem("bol-tab", tabId); } catch {}
    setMobileMenuOpen(false);
    if (tabId === "predictions") setPredictionScrollRequest((current) => current + 1);
    if (tabId === "results") setResultScrollRequest((current) => current + 1);
    if (tabId !== "predictions" && tabId !== "results") {
      window.requestAnimationFrame(() => {
        workspaceRef.current?.scrollTo({ top: 0, behavior: "auto" });
      });
    }
    if (tabId === "groups" || tabId === "bracket" || tabId === "results") {
      fetchPoolState()
        .then((remote) => {
          const cleanedRemote = cleanPoolState(remote);
          saveCachedPoolState(cleanedRemote);
          setState((current) => applyRemoteData(current, cleanedRemote));
        })
        .catch(() => {});
    }
  }

  // Optimistically update state then persist to Cloudflare D1
  function updateState(recipe) {
    // Compute nextState using the current closure value of `state` so it is
    // available synchronously - React 19 batches setState callbacks lazily
    // and the updater may not run before persistAndSync needs the value.
    const nextState = typeof recipe === "function" ? recipe(state) : recipe;
    // Skip persist when the recipe returned the same reference. An extra write would race with concurrent writes
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

  async function refreshResults() {
    setSyncStatus({ state: "loading", message: "Buscando placares mais recentes..." });
    try {
      const remote = await withTimeout(fetchPoolState(), DATA_LOAD_TIMEOUT_MS, "Tempo excedido ao buscar os placares.");
      const cleanedRemote = cleanPoolState(remote);
      saveCachedPoolState(cleanedRemote);
      setState((current) => applyRemoteData(current, cleanedRemote));
      setSyncStatus({ state: "success", message: "Placares mais recentes carregados." });
    } catch (error) {
      setSyncStatus({ state: "error", message: `Não consegui buscar os placares agora. ${error.message}` });
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

  async function saveProfile({ name, email, avatarUrl, currentPassword, newPassword }) {
    const cleanName = String(name || "").trim();
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanAvatarUrl = String(avatarUrl || "");
    const passwordRequested = Boolean(newPassword);
    const emailChanged = cleanEmail !== String(currentUser.email || "").toLowerCase();

    if (!cleanName) throw new Error("Informe seu nome.");
    if (!cleanEmail.includes("@") || !cleanEmail.includes(".")) throw new Error("Informe um e-mail válido.");
    if (passwordRequested && newPassword.length < 6) throw new Error("A nova senha deve ter pelo menos 6 caracteres.");

    const emailTaken =
      state.users.some((user) => user.id !== currentUser.id && String(user.email || "").toLowerCase() === cleanEmail) ||
      state.participants.some((participant) => participant.id !== currentUser.participantId && String(participant.email || "").toLowerCase() === cleanEmail);
    if (emailTaken) throw new Error("Este e-mail já está cadastrado.");

    if (emailChanged || passwordRequested) {
      if (!currentPassword) throw new Error("Informe sua senha atual para alterar e-mail ou senha.");
      if (!(await verifyPassword(currentUser, currentPassword))) throw new Error("A senha atual está incorreta.");
    }

    const updatedAt = new Date().toISOString();
    let updatedUser = {
      ...currentUser,
      name: cleanName,
      email: cleanEmail,
      avatarUrl: cleanAvatarUrl,
      updatedAt
    };
    if (passwordRequested) updatedUser = await attachPasswordCredential(updatedUser, newPassword);

    const changedFields = [
      cleanName !== currentUser.name ? "nome" : "",
      emailChanged ? "e-mail" : "",
      cleanAvatarUrl !== String(currentUser.avatarUrl || "") ? "foto" : "",
      passwordRequested ? "senha" : ""
    ].filter(Boolean);

    updateState((current) => appendAuditLog(
      {
        ...current,
        users: current.users.map((user) => user.id === currentUser.id ? updatedUser : user),
        participants: current.participants.map((participant) =>
          participant.id === currentUser.participantId
            ? { ...participant, name: cleanName, email: cleanEmail, avatarUrl: cleanAvatarUrl, updatedAt }
            : participant
        )
      },
      makeAuditEntry(cleanName, "profile_updated", changedFields.length ? changedFields.join(", ") : "sem alterações")
    ));
    setSharedStatus({ state: "success", message: "Perfil atualizado com sucesso." });
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

  return (
    <main className={`app-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      {mobileMenuOpen && <div className="menu-overlay" onClick={() => setMobileMenuOpen(false)} />}
      <aside className={`sidebar${mobileMenuOpen ? " open" : ""}${sidebarCollapsed ? " collapsed" : ""}`}>
        <div className="brand-block">
          {sidebarCollapsed
            ? <img src={FAVICON_URL} className="brand-favicon" alt="Bolão" />
            : <img src={AUTH_LOGO_URL} className="brand-logo" alt="Bolão Grupo Bit" fetchPriority="high" />
          }
          <button type="button" className="menu-close" aria-label="Fechar menu" onClick={() => setMobileMenuOpen(false)}>×</button>
        </div>
        <nav className="tabs" aria-label="Seções do bolão">
          {visibleTabs.map((item) => (
            <button type="button" className={tab === item.id ? "active" : ""} key={item.id} onClick={() => handleTabClick(item.id)} data-label={item.label} aria-current={tab === item.id ? "page" : undefined}>
              {item.icon && <FontAwesomeIcon icon={item.icon} className="tab-icon" />}
              <span className="tab-label">{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-actions">
            <button type="button" data-label="Sair" onClick={logoutUser}>
              <FontAwesomeIcon icon={faRightFromBracket} className="tab-icon" />
              <span className="tab-label">Sair</span>
            </button>
          </div>
        </div>
      </aside>

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
            <button
              type="button"
              className="sidebar-collapse-btn"
              aria-label={sidebarCollapsed ? "Expandir menu" : "Recolher menu"}
              onClick={() => setSidebarCollapsed((v) => !v)}
            >
              <FontAwesomeIcon icon={sidebarCollapsed ? faChevronRight : faChevronLeft} />
            </button>
            <div className="topbar-title">
              <p className="eyebrow">Copa do Mundo 2026</p>
              <h1>{tab === "profile" ? "Perfil" : visibleTabs.find((item) => item.id === tab)?.label ?? "Bolão"}</h1>
            </div>
          </div>
          <img src={FAVICON_URL} alt="Bolão Copa 2026" className="topbar-logo-mobile" />
          <div className="topbar-user-menu" ref={userMenuRef}>
            <button
              type="button"
              className={`topbar-user topbar-user-button${userMenuOpen ? " active" : ""}`}
              aria-label="Menu do usuário"
              aria-expanded={userMenuOpen}
              onClick={() => setUserMenuOpen((v) => !v)}
            >
              <span className="topbar-user-name">{currentUser.name}</span>
              <UserAvatar user={currentUser} />
            </button>
            {userMenuOpen && (
              <div className="user-dropdown" role="menu">
                <button type="button" role="menuitem" onClick={() => { handleTabClick("profile"); setUserMenuOpen(false); }}>
                  <FontAwesomeIcon icon={faUser} />
                  Perfil
                </button>
                <button type="button" role="menuitem" onClick={() => { logoutUser(); setUserMenuOpen(false); }}>
                  <FontAwesomeIcon icon={faRightFromBracket} />
                  Sair
                </button>
              </div>
            )}
          </div>
        </header>

        {tab === "profile" && (
          <ProfilePage
            user={currentUser}
            participant={userParticipant}
            onSave={saveProfile}
          />
        )}

        {tab === "settings" && isAdmin && (
          <div className="settings-layout">
            <div className="settings-header">
              <p className="settings-header-title">Configurações</p>
              <nav className="settings-tabs-nav" aria-label="Seções de configurações">
                {settingsTabs.map((item) => (
                  <button
                    type="button"
                    className={settingsTab === item.id ? "active" : ""}
                    key={item.id}
                    aria-current={settingsTab === item.id ? "page" : undefined}
                    onClick={() => {
                      setSettingsTab(item.id);
                      try { sessionStorage.setItem("bol-settings-tab", item.id); } catch {}
                    }}
                  >
                    <FontAwesomeIcon icon={item.icon} className="settings-nav-icon" />
                    {item.label}
                  </button>
                ))}
              </nav>
            </div>

            <div className="settings-content">
              {settingsTab === "participants" && (
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
                          <label className="form-field">
                            <span>Nome</span>
                            <input name="name" placeholder="Nome do participante" autoComplete="name" autoFocus required />
                          </label>
                          <label className="form-field">
                            <span>E-mail</span>
                            <input name="email" type="email" placeholder="E-mail do participante" autoComplete="email" required />
                          </label>
                          <label className="form-field">
                            <span>Senha inicial</span>
                            <input name="password" type="password" placeholder="Mínimo de 6 caracteres" autoComplete="new-password" minLength="6" required />
                          </label>
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

              {settingsTab === "rounds" && (
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

              {settingsTab === "audit" && (
                <section className="panel">
                  <SectionHeader title="Logs do sistema" caption={`${state.auditLogs?.length ?? 0} / ${AUDIT_LOG_LIMIT} registros`} />
                  <AuditLogPanel logs={state.auditLogs} />
                </section>
              )}
            </div>
          </div>
        )}



        {tab === "predictions" && (
          <section className="panel">
            <SectionHeader title="Palpites" />
            <div className="prediction-toolbar single">
              <label className="select-label">
                Rodada
                <select value={activePredictionRound} onChange={(event) => {
                  setSelectedPredictionRound(Number(event.target.value));
                  setPredictionScrollRequest((current) => current + 1);
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
                  const matchHasStarted = hasMatchStarted(match, clockNow);
                  const isKickoffLocked = isMatchClosed(match, clockNow);
                  const isLocked = isRoundLocked || isKickoffLocked;
                  const predictionFeedback = getPredictionFeedback(storedPrediction, match);
                  const homeTeamName = teamsById[match.homeTeamId]?.name ?? match.home ?? "time da casa";
                  const awayTeamName = teamsById[match.awayTeamId]?.name ?? match.away ?? "time visitante";
                  return (
                    <article
                      className={`match-card prediction-card ${isLocked ? "locked" : ""}`}
                      key={match.id}
                      ref={match.id === predictionScrollTargetId ? predictionTargetRef : null}
                    >
                        <div className="prediction-card-vote">
                        {predictionFeedback?.className === "exact" && <Confetti />}
                        <div className="prediction-match-info">
                          <span className="badge">{match.phase}</span>
                          <div className="prediction-teams-grid">
                            <PredictionTeamColumn side="home" teamId={match.homeTeamId} fallback={match.home} onHistory={setHistoryTeamId} />
                            <span className="prediction-versus">x</span>
                            <PredictionTeamColumn side="away" teamId={match.awayTeamId} fallback={match.away} onHistory={setHistoryTeamId} />
                          </div>
                          <p>{formatDate(match.date)}</p>
                          <p className="match-location">{formatVenue(match)}</p>
                          </div>
                          <div className="prediction-actions">
                          <div className="prediction-inputs">
                            <ScoreInput label={`Placar de ${homeTeamName}`} disabled={isLocked} value={prediction.home} onChange={(value) => updateDraftPrediction(activeParticipant.id, match.id, "home", value)} />
                            <span>x</span>
                            <ScoreInput label={`Placar de ${awayTeamName}`} disabled={isLocked} value={prediction.away} onChange={(value) => updateDraftPrediction(activeParticipant.id, match.id, "away", value)} />
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
                          {predictionFeedback && (
                            <span className={`prediction-feedback-pill ${predictionFeedback.className}`}>
                              {predictionFeedback.label}
                            </span>
                          )}
                        </div>
                      </div>
                      {matchHasStarted ? (
                        <MatchPredictionOverview
                          match={match}
                          participants={contestParticipants}
                          predictions={state.predictions}
                        />
                      ) : (
                        <div className="prediction-card-overview private" role="note">
                          <div className="prediction-card-private-notice">
                            <strong>Palpites protegidos</strong>
                            <span>Os palpites dos outros participantes serão exibidos somente após o início deste jogo.</span>
                          </div>
                        </div>
                      )}
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
              <span>{state.lastResultSyncAt ? `Última checagem do servidor: ${formatDate(state.lastResultSyncAt)}. ${resultSyncIntervalText}` : resultSyncIntervalText}</span>
            </div>
            <div className="prediction-toolbar">
              <label className="select-label">
                Rodada
                <select value={activeResultRound} onChange={(event) => {
                  setSelectedResultRound(Number(event.target.value));
                  setResultScrollRequest((current) => current + 1);
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
            <ResultsList
              activeParticipant={activeParticipant}
              matches={resultMatches}
              predictions={state.predictions}
              scrollTargetId={resultScrollTargetId}
              scrollTargetRef={resultTargetRef}
            />
          </section>
        )}

        {tab === "groups" && <GroupStandingsBoard groups={groupStandings} />}

        {tab === "bracket" && <KnockoutBracketBoard bracket={knockoutBracket} />}

        {tab === "ranking" && <RankingTable ranking={ranking} matches={state.matches} predictions={state.predictions} />}
      </section>
    </main>
  );
}

function TurnstileWidget({ onToken, resetKey }) {
  const containerRef = useRef(null);
  const onTokenRef = useRef(onToken);

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let widgetId;
    let cancelled = false;
    const scriptId = "cloudflare-turnstile-script";

    function renderWidget() {
      if (cancelled || !containerRef.current || !window.turnstile) return;
      widgetId = window.turnstile.render(containerRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        action: "turnstile-spin-v1",
        callback: (token) => onTokenRef.current(token),
        "expired-callback": () => onTokenRef.current(""),
        "error-callback": () => onTokenRef.current("")
      });
    }

    let script = document.getElementById(scriptId);
    if (window.turnstile) {
      renderWidget();
    } else {
      if (!script) {
        script = document.createElement("script");
        script.id = scriptId;
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", renderWidget);
    }

    return () => {
      cancelled = true;
      script?.removeEventListener("load", renderWidget);
      if (widgetId !== undefined && window.turnstile) {
        window.turnstile.remove(widgetId);
      }
    };
  }, [resetKey]);

  return (
    <div className="turnstile-shell">
      <div
        ref={containerRef}
        className="cf-turnstile"
        data-sitekey={TURNSTILE_SITE_KEY}
        data-action="turnstile-spin-v1"
      />
    </div>
  );
}

function AuthScreen({ error, onLogin, onRegister }) {
  const [mode, setMode] = useState("login");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileError, setTurnstileError] = useState("");
  const [turnstileChecking, setTurnstileChecking] = useState(false);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);

  function changeMode(nextMode) {
    setMode(nextMode);
    setTurnstileToken("");
    setTurnstileError("");
    setTurnstileResetKey((key) => key + 1);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    setTurnstileError("");
    setTurnstileChecking(true);

    const verification = await verifyTurnstileToken(turnstileToken);
    if (!verification.success) {
      setTurnstileError(verification.message);
      setTurnstileToken("");
      setTurnstileResetKey((key) => key + 1);
      setTurnstileChecking(false);
      return;
    }

    try {
      await (mode === "register" ? onRegister(payload) : onLogin(payload));
    } finally {
      setTurnstileChecking(false);
      setTurnstileToken("");
      setTurnstileResetKey((key) => key + 1);
    }
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
          <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => changeMode("register")}>Criar conta</button>
          <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => changeMode("login")}>Entrar</button>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === "register" && <label className="form-field"><span>Nome</span><input name="firstName" placeholder="Seu nome" autoComplete="given-name" required /></label>}
          {mode === "register" && <label className="form-field"><span>Sobrenome</span><input name="lastName" placeholder="Seu sobrenome" autoComplete="family-name" required /></label>}
          <label className="form-field"><span>E-mail</span><input name="email" type="email" placeholder="voce@exemplo.com" autoComplete="email" required /></label>
          <label className="form-field"><span>Senha</span><input name="password" type="password" placeholder="Sua senha" autoComplete={mode === "register" ? "new-password" : "current-password"} minLength="6" required /></label>
          <TurnstileWidget
            resetKey={turnstileResetKey}
            onToken={(token) => {
              setTurnstileToken(token);
              if (token) setTurnstileError("");
            }}
          />
          {turnstileError && <p className="form-error">{turnstileError}</p>}
          {error && <p className="form-error">{error}</p>}
          <button type="submit" disabled={turnstileChecking}>
            {turnstileChecking ? "Verificando..." : mode === "register" ? "Cadastrar e entrar" : "Entrar"}
          </button>
        </form>
      </section>
    </main>
  );
}

function UserAvatar({ user, large = false }) {
  const className = `profile-avatar${large ? " large" : ""}`;
  return user?.avatarUrl ? (
    <span className={className} aria-hidden="true">
      <img src={user.avatarUrl} alt="" />
    </span>
  ) : (
    <span className={className} aria-hidden="true">{getUserInitials(user?.name)}</span>
  );
}

function ProfilePage({ user, participant, onSave }) {
  const [form, setForm] = useState(() => ({
    name: user.name || participant?.name || "",
    email: user.email || participant?.email || "",
    avatarUrl: user.avatarUrl || participant?.avatarUrl || "",
    currentPassword: "",
    newPassword: "",
    confirmPassword: ""
  }));
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);

  function changeField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setError("");
    setSuccess("");
  }

  async function changePhoto(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setSuccess("");
    try {
      const avatarUrl = await resizeProfileImage(file);
      setForm((current) => ({ ...current, avatarUrl }));
    } catch (imageError) {
      setError(imageError.message);
    } finally {
      event.target.value = "";
    }
  }

  async function submitProfile(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (form.newPassword !== form.confirmPassword) {
      setError("A confirmação da nova senha não confere.");
      return;
    }
    setSaving(true);
    try {
      await onSave(form);
      setForm((current) => ({
        ...current,
        currentPassword: "",
        newPassword: "",
        confirmPassword: ""
      }));
      setSuccess("Perfil atualizado com sucesso.");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  const previewUser = { ...user, name: form.name, avatarUrl: form.avatarUrl };

  return (
    <section className="panel profile-page" aria-labelledby="profile-page-title">
      <SectionHeader
        title="Meu perfil"
        caption="Atualize sua foto, seus dados de acesso e suas informações pessoais."
        titleId="profile-page-title"
      />
      <form className="modal-form profile-form" onSubmit={submitProfile}>
          <div className="profile-photo-section">
            <UserAvatar user={previewUser} large />
            <div className="profile-photo-copy">
              <strong>Foto do perfil</strong>
              <span>JPG, PNG ou WebP de até 5 MB.</span>
              <div className="profile-photo-actions">
                <label className="profile-file-button">
                  {form.avatarUrl ? "Trocar foto" : "Adicionar foto"}
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={changePhoto} />
                </label>
                {form.avatarUrl && (
                  <button type="button" className="ghost" onClick={() => changeField("avatarUrl", "")}>Remover foto</button>
                )}
              </div>
            </div>
          </div>

          <div className="profile-form-grid">
            <label className="profile-field full">
              <span>Nome completo</span>
              <input value={form.name} autoComplete="name" onChange={(event) => changeField("name", event.target.value)} required />
            </label>
            <label className="profile-field full">
              <span>E-mail</span>
              <input type="email" value={form.email} autoComplete="email" onChange={(event) => changeField("email", event.target.value)} required />
            </label>
          </div>

          <div className="profile-password-section">
            <div>
              <strong>Segurança</strong>
              <p>Preencha a senha atual somente para alterar o e-mail ou criar uma nova senha.</p>
            </div>
            <div className="profile-form-grid">
              <label className="profile-field full">
                <span>Senha atual</span>
                <input type="password" value={form.currentPassword} autoComplete="current-password" onChange={(event) => changeField("currentPassword", event.target.value)} />
              </label>
              <label className="profile-field">
                <span>Nova senha</span>
                <input type="password" value={form.newPassword} autoComplete="new-password" onChange={(event) => changeField("newPassword", event.target.value)} minLength={6} />
              </label>
              <label className="profile-field">
                <span>Confirmar nova senha</span>
                <input type="password" value={form.confirmPassword} autoComplete="new-password" onChange={(event) => changeField("confirmPassword", event.target.value)} minLength={6} />
              </label>
            </div>
          </div>

          {error && <p className="form-error profile-feedback">{error}</p>}
          {success && <p className="profile-success profile-feedback">{success}</p>}

          <div className="profile-page-actions">
            <button type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar perfil"}</button>
          </div>
      </form>
    </section>
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

function PredictionTeamColumn({ side = "", teamId, fallback, onHistory }) {
  const team = teamsById[teamId];
  return (
    <div className={`prediction-team-column ${side}`}>
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
            {teamMatches.map((match) => {
              const { homeScore, awayScore, statusLabel, statusClass } = getResultMeta(match);
              return (
                <article className="team-history-item" key={match.id}>
                  <div className="team-history-tags">
                    <span className="badge">{match.phase}</span>
                    <span className={`result-status ${statusClass}`}>{statusLabel}</span>
                  </div>
                  <div className="team-history-teams">
                    <span className="team-history-team home">
                      <TeamName teamId={match.homeTeamId} fallback={match.home} />
                    </span>
                    <span className="team-history-versus">x</span>
                    <span className="team-history-team away">
                      <TeamName teamId={match.awayTeamId} fallback={match.away} />
                    </span>
                  </div>
                  <div className="team-history-score">
                    <strong>{homeScore ?? "-"}</strong>
                    <span>x</span>
                    <strong>{awayScore ?? "-"}</strong>
                  </div>
                  <div className="team-history-details">
                    <span>{formatDate(match.date)}</span>
                    <strong>{formatVenue(match)}</strong>
                  </div>
                </article>
              );
            })}
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

function SectionHeader({ title, caption, titleId }) {
  return <header className="section-header"><h2 id={titleId}>{title}</h2>{caption && <p>{caption}</p>}</header>;
}

function ScoreInput({ label, value, onChange, disabled = false }) {
  return <input aria-label={label} className="score-input" disabled={disabled} min="0" inputMode="numeric" type="number" value={value} onChange={(event) => onChange(event.target.value)} placeholder="0" />;
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

function RankingTable({ ranking, matches = [], predictions = {}, compact = false }) {
  const paidParticipants = ranking.length;
  const totalPoolValue = paidParticipants * ENTRY_FEE;
  const displayedRanking = ranking;
  const rankOffset = 0;
  const hasLiveMatches = matches.some(isMatchLive);
  const [auditParticipant, setAuditParticipant] = useState(null);

  return (
    <section className="panel table-panel">
      <SectionHeader title={compact ? "Top 5" : "Ranking"} />
      {hasLiveMatches && (
        <div className="live-ranking-notice">
          <span className="live-dot" /> Pontuação parcial ao vivo — atualiza a cada 30s
        </div>
      )}
      {!compact && <PrizePodium ranking={ranking} totalPoolValue={totalPoolValue} />}
      {displayedRanking.length ? (
        <div className="table-wrap">
          <table className="ranking-table">
            <thead><tr><th>Colocação</th><th>Participante</th><th>Pontos</th><th>Cravados</th><th>Acertos 1 pt</th><th>Jogos pontuados</th>{!compact && <th>Auditoria</th>}</tr></thead>
            <tbody>
              {displayedRanking.map((participant, index) => (
                <tr key={participant.id}>
                  <td>
                    <span className={`rank-position ${compact && index === 0 ? "rank-position-leader" : ""}`}>
                      {compact && index === 0 ? <FontAwesomeIcon icon={faTrophy} title="Primeiro colocado" /> : rankOffset + index + 1}
                    </span>
                  </td>
                  <td className="participant-cell">
                    <div className="ranking-participant">
                      <UserAvatar user={participant} />
                      <span>{participant.name}</span>
                    </div>
                  </td>
                  <td><strong className="points-pill">{participant.total}</strong></td>
                  <td>{participant.exactScores}</td>
                  <td>{participant.winnerHits}</td>
                  <td>{participant.scoredMatches}</td>
                  {!compact && (
                    <td className="audit-cell">
                      <button type="button" className="audit-eye-btn" onClick={() => setAuditParticipant(participant)} aria-label={`Ver auditoria de ${participant.name}`} title={`Ver auditoria de ${participant.name}`}>
                        <FontAwesomeIcon icon={faEye} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyState text={ranking.length ? "Os três primeiros colocados aparecem no pódio." : "O ranking aparece quando houver participantes cadastrados."} />}
      {!compact && (
        <div className="ranking-details">
          <h2 className="ranking-details-title">Informativo</h2>
          <div className="ranking-summary">
            <div>
              <span>Valor por participante</span>
              <strong>{formatCurrency(ENTRY_FEE)}</strong>
            </div>
            <div>
              <span>Total arrecadado</span>
              <strong>{formatCurrency(totalPoolValue)}</strong>
            </div>
            <div>
              <span>Apostadores</span>
              <strong>{paidParticipants}</strong>
            </div>
          </div>
          <ScoringExamples />
          <div className="ranking-info-grid">
            <RankingTiebreakerCard />
            <RankingPrizeNote />
          </div>
        </div>
      )}
      {auditParticipant && (
        <AuditModal
          participant={auditParticipant}
          matches={matches}
          predictions={predictions}
          onClose={() => setAuditParticipant(null)}
        />
      )}
    </section>
  );
}


const CONFETTI_PIECES = [
  { left:  8, delay: 0.0, dur: 2.2, color: "#bd2124", w: 6,  h: 10 },
  { left: 18, delay: 0.4, dur: 2.8, color: "#0ecb81", w: 8,  h:  6 },
  { left: 28, delay: 0.8, dur: 2.4, color: "#1e2026", w: 5,  h:  9 },
  { left: 38, delay: 0.2, dur: 2.6, color: "#d0980b", w: 7,  h:  7 },
  { left: 50, delay: 0.6, dur: 2.1, color: "#bd2124", w: 6,  h:  8 },
  { left: 62, delay: 1.0, dur: 2.9, color: "#0ecb81", w: 9,  h:  5 },
  { left: 72, delay: 0.3, dur: 2.3, color: "#848e9c", w: 5,  h: 10 },
  { left: 82, delay: 0.7, dur: 2.7, color: "#d0980b", w: 7,  h:  6 },
  { left: 92, delay: 0.1, dur: 2.5, color: "#bd2124", w: 6,  h:  8 },
  { left: 14, delay: 1.2, dur: 2.2, color: "#1e2026", w: 8,  h:  5 },
  { left: 44, delay: 0.9, dur: 2.6, color: "#848e9c", w: 5,  h:  9 },
  { left: 58, delay: 0.5, dur: 2.4, color: "#0ecb81", w: 7,  h:  7 },
  { left: 76, delay: 1.3, dur: 2.8, color: "#d0980b", w: 6,  h:  6 },
  { left: 32, delay: 1.1, dur: 2.1, color: "#bd2124", w: 9,  h:  5 },
  { left: 88, delay: 0.8, dur: 2.3, color: "#1e2026", w: 5,  h:  8 },
];

function Confetti() {
  return (
    <div className="confetti-wrap" aria-hidden="true">
      {CONFETTI_PIECES.map((p, i) => (
        <span
          key={i}
          className="confetti-piece"
          style={{
            left: `${p.left}%`,
            width: p.w,
            height: p.h,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.dur}s`,
          }}
        />
      ))}
    </div>
  );
}

function AuditModal({ participant, matches, predictions, onClose }) {
  const participantPredictions = predictions[participant.id] ?? {};
  const scoredMatches = matches
    .filter((match) => isMatchResultFinal(match) || isMatchLive(match))
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    .map((match) => {
      const prediction = participantPredictions[match.id];
      const points = scorePrediction(prediction, match);
      return { match, prediction, points };
    });
  const total = scoredMatches.reduce((sum, r) => sum + r.points, 0);

  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel audit-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Auditoria — {participant.name}</h2>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Fechar">×</button>
        </div>
        {scoredMatches.length ? (
          <div className="audit-cards-wrap">
            <div className="audit-cards-toolbar">
              <div className="audit-cards-summary">
                <span>{scoredMatches.length} jogos analisados</span>
                <strong>{total} pontos no total</strong>
              </div>
            </div>
            <div className="audit-cards-grid">
              {scoredMatches.map(({ match, prediction, points }, index) => {
                const hasParticipantPrediction = hasPrediction(prediction);
                const isBlocked = !hasParticipantPrediction && clearedOpeningPredictionMatchIds.includes(match.id);
                const resultLabel = points === 3
                  ? "Placar exato"
                  : points === 1
                    ? "Resultado correto"
                    : hasParticipantPrediction ? "Não pontuou" : isBlocked ? "Bloqueado" : "Sem palpite";

                return (
                  <article key={match.id} className={`audit-game-card audit-game-card-${points === 3 ? "exact" : points === 1 ? "winner" : isBlocked ? "blocked" : hasParticipantPrediction ? "miss" : "noprediction"}`}>
                    {points === 3 && <Confetti />}
                    <div className="audit-game-card-header">
                      <span>Jogo {String(index + 1).padStart(2, "0")}</span>
                      <span className={`audit-card-result audit-card-result-${points === 3 ? "exact" : points === 1 ? "winner" : isBlocked ? "blocked" : "miss"}`}>
                        {resultLabel}
                      </span>
                    </div>

                    <div className="audit-card-matchup">
                      <div className="audit-card-team">
                        <TeamName teamId={match.homeTeamId} fallback={match.home} />
                      </div>
                      <span className="audit-card-versus">×</span>
                      <div className="audit-card-team">
                        <TeamName teamId={match.awayTeamId} fallback={match.away} />
                      </div>
                    </div>

                    <div className="audit-card-details">
                      <div className="audit-card-stat">
                        <span>Resultado</span>
                        <strong>{match.homeScore} <small>×</small> {match.awayScore}</strong>
                      </div>
                      <div className="audit-card-stat">
                        <span>Palpite</span>
                        <strong className={!hasParticipantPrediction ? "audit-no-prediction" : ""}>
                          {hasParticipantPrediction ? `${prediction.home} × ${prediction.away}` : "— × —"}
                        </strong>
                      </div>
                      <div className="audit-card-stat audit-card-points">
                        <span>Pontos</span>
                        <strong className={`points-pill ${points === 3 ? "exact" : points === 1 ? "winner" : ""}`}>{points}</strong>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="audit-empty">Nenhuma partida pontuada ainda.</p>
        )}
      </div>
    </div>
  );
}

function ResultsList({ activeParticipant, matches, predictions, scrollTargetId, scrollTargetRef }) {
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

  if (!matches.length) return <EmptyState text="Nenhum jogo cadastrado para este dia." />;

  return (
    <div className="match-list results-list">
      {matches.map((match) => (
        <ResultCard
          activeParticipant={activeParticipant}
          key={match.id}
          ref={match.id === scrollTargetId ? scrollTargetRef : null}
          match={match}
          isOpen={openMatchId === match.id}
          onToggle={() => setOpenMatchId((current) => current === match.id ? "" : match.id)}
          predictions={predictions}
        />
      ))}
    </div>
  );
}

function getResultMeta(match) {
  const homeScore = parseScoreValue(match.homeScore);
  const awayScore = parseScoreValue(match.awayScore);
  const hasResult = Number.isInteger(homeScore) && Number.isInteger(awayScore);
  const homeWon = hasResult && homeScore > awayScore;
  const awayWon = hasResult && awayScore > homeScore;
  const rawStatus = String(match.status || match.statusShort || "").toLowerCase();
  const isLive = rawStatus === "live" || ["1h", "ht", "2h", "et", "bt", "p", "int"].includes(rawStatus);
  const isFinished = isMatchResultFinal(match);
  const isPostponed = rawStatus === "postponed" || rawStatus === "pst" || rawStatus === "susp";
  const isCancelled = rawStatus === "cancelled" || rawStatus === "canc" || rawStatus === "abd";
  const inferredLive = !rawStatus && !hasResult && isMatchClosed(match);
  const statusClass = isFinished ? "finished" : isLive || inferredLive ? "live" : "pending";
  const statusLabel = isFinished
    ? "Resultado atualizado"
    : isLive
      ? "Em execução"
      : isPostponed
        ? "Jogo adiado"
        : isCancelled
          ? "Jogo cancelado"
          : inferredLive
            ? "Em execução"
            : "Aguardando resultado";
  return {
    homeScore,
    awayScore,
    hasResult,
    homeWon,
    awayWon,
    isLive: isLive || inferredLive,
    statusLabel,
    statusClass
  };
}

const ResultCard = React.forwardRef(function ResultCard({ activeParticipant, match, isOpen, onToggle, predictions }, ref) {
  const {
    homeScore,
    awayScore,
    statusLabel,
    statusClass
  } = getResultMeta(match);
  const userPrediction = activeParticipant ? predictions?.[activeParticipant.id]?.[match.id] : null;
  const isExactScore = hasPrediction(userPrediction) && scorePrediction(userPrediction, match) === 3;

  return (
    <article
      ref={ref}
      className={`match-card result-card result-accordion ${statusClass} ${isOpen ? "open" : ""}`}
    >
      {isExactScore && <Confetti />}
      <button type="button" className="result-accordion-toggle" onClick={onToggle} aria-expanded={isOpen}>
        <div className="result-card-tags">
          <span className="badge">{match.phase}</span>
          <span className={`result-status ${statusClass}`}>{statusLabel}</span>
        </div>
        <div className="result-card-teams">
          <span className="result-card-team home">
            <TeamName teamId={match.homeTeamId} fallback={match.home} />
          </span>
          <span className="result-card-versus">x</span>
          <span className="result-card-team away">
            <TeamName teamId={match.awayTeamId} fallback={match.away} />
          </span>
        </div>
        <div className="result-card-score-row">
          <div className="result-accordion-score">
            <strong>{homeScore === null ? "-" : homeScore}</strong>
            <span>x</span>
            <strong>{awayScore === null ? "-" : awayScore}</strong>
          </div>
        </div>
        <div className="result-user-prediction">
          <span>Seu palpite</span>
          <strong>{hasPrediction(userPrediction) ? formatPrediction(userPrediction) : "Sem palpite"}</strong>
        </div>
        <p className="result-card-date">{formatDate(match.date)}</p>
        <p className="result-card-venue">{formatVenue(match)}</p>
        <span className="result-accordion-icon" aria-hidden="true">{isOpen ? "−" : "+"}</span>
      </button>
      {isOpen && (
        <div className="result-accordion-body">
          <ResultGoals match={match} />
        </div>
      )}
    </article>
  );
});

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
            <thead><tr><th>Participante</th><th>Palpite</th><th>Acerto</th></tr></thead>
            <tbody>
              {offeredPredictions.map(({ participant, prediction }) => {
                const feedback = getPredictionFeedback(prediction, match, { compact: true });
                return (
                  <tr key={participant.id}>
                    <td>{participant.name}</td>
                    <td><span className="prediction-pill">{formatPrediction(prediction)}</span></td>
                    <td>
                      {feedback ? (
                        <span className={`prediction-feedback-pill compact ${feedback.className}`} title={feedback.description ?? feedback.label}>
                          {feedback.label}
                        </span>
                      ) : (
                        <span className="prediction-feedback-muted">Aguardando</span>
                      )}
                    </td>
                  </tr>
                );
              })}
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

function getPredictionFeedback(prediction, match, options = {}) {
  if (!hasPrediction(prediction)) return null;
  if (!isMatchResultFinal(match)) return null;
  const actualHome = parseScoreValue(match?.homeScore);
  const actualAway = parseScoreValue(match?.awayScore);
  if (actualHome === null || actualAway === null) return null;

  const points = scorePrediction(prediction, match);
  if (points === 3) {
    return {
      label: options.compact ? "+3" : "Você cravou +3 pts",
      description: "Cravou o placar",
      className: "exact"
    };
  }
  if (points === 1) {
    const predictedHome = parseScoreValue(prediction.home);
    const predictedAway = parseScoreValue(prediction.away);
    const isDrawHit = predictedHome === predictedAway && actualHome === actualAway;
    return {
      label: options.compact
        ? "+1"
        : (isDrawHit ? "Você acertou o empate +1 pt" : "Você acertou o vencedor +1 pt"),
      description: isDrawHit ? "Acertou o empate" : "Acertou o vencedor",
      className: "hit"
    };
  }
  return {
    label: options.compact ? "0" : "Você não pontuou",
    description: "Não pontuou",
    className: "miss"
  };
}

function formatPrediction(prediction) {
  if (!prediction || prediction.home === "" || prediction.away === "") return "Sem palpite";
  return `${prediction.home} x ${prediction.away}`;
}

function formatGoalMinute(goal) {
  if (goal.minute === "" || goal.minute === null || goal.minute === undefined) return "-";
  return goal.offset ? `${goal.minute}+${goal.offset}'` : `${goal.minute}'`;
}

function PrizePodium({ ranking, totalPoolValue }) {
  const podium = [
    { rank: 2, participant: ranking[1], prize: PRIZE_DISTRIBUTION[1] },
    { rank: 1, participant: ranking[0], prize: PRIZE_DISTRIBUTION[0] },
    { rank: 3, participant: ranking[2], prize: PRIZE_DISTRIBUTION[2] }
  ];

  return (
    <div className="prize-podium" aria-label="Pódio da premiação">
      <div className="prize-podium-heading">
        <span>Premiação</span>
      </div>
      <div className="podium-stage">
        {podium.map(({ rank, participant, prize }) => (
          <article className={`podium-place podium-place-${rank}`} key={prize.label}>
            <div className="podium-profile" aria-label={`${rank}º lugar`}>
              <UserAvatar user={participant ?? { name: "Aguardando participante" }} />
              <span className="podium-trophy" aria-hidden="true">
                <img
                  src={rank === 1 ? TACA_URL : rank === 2 ? TACA_PRATA_URL : TACA_BRONZE_URL}
                  alt=""
                  className="podium-trophy-img"
                />
              </span>
            </div>
            <div className="podium-person">
              <strong>{participant?.name ?? "Aguardando participante"}</strong>
              <span>{participant ? `${participant.total} ponto${participant.total === 1 ? "" : "s"}` : "Sem pontuação"}</span>
            </div>
            <div className="podium-prize">
              <strong>{formatCurrency(totalPoolValue * prize.percent / 100)}</strong>
              <span>{prize.percent}% do total</span>
            </div>
            <div className="podium-step">
              <span>{prize.label}</span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function RankingPrizeNote() {
  return (
    <div className="ranking-prize-note">
      <span>Premiação final</span>
      <strong>O valor acumulado será dividido entre os três primeiros colocados ao final do campeonato.</strong>
    </div>
  );
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
                    <tr key={row.teamId} className={index < 2 ? "qualified" : (index > 2 && row.played >= 3) ? "eliminated" : ""}>
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

function KnockoutBracketBoard({ bracket }) {
  const qualifiedThirds = bracket.thirdPlacedTeams.filter((team) => team.qualified);
  const round32ById = new Map(bracket.rounds.roundOf32.map((match) => [match.id, match]));
  const round16ById = new Map(bracket.rounds.roundOf16.map((match) => [match.id, match]));
  const quarterById = new Map(bracket.rounds.quarterFinals.map((match) => [match.id, match]));
  const semiById = new Map(bracket.rounds.semiFinals.map((match) => [match.id, match]));
  const selectMatches = (map, ids) => ids.map((id) => map.get(id));

  return (
    <section className="panel knockout-panel">
      <SectionHeader
        title="Chaveamento"
        caption="Confrontos da rodada de 32 definidos pela classificação dos grupos."
      />

      <div className={`knockout-status ${bracket.groupsComplete ? "confirmed" : "projected"}`}>
        <span>{bracket.groupsComplete ? "Classificação encerrada" : "Projeção ao vivo"}</span>
        <strong>
          {bracket.groupsComplete
            ? "Os classificados da fase de grupos estão definidos."
            : "O chaveamento será confirmado quando todos os jogos da 3ª rodada terminarem."}
        </strong>
      </div>

      <section className="knockout-tree-section" aria-labelledby="knockout-tree-title">
        <div className="knockout-subheading">
          <div>
            <span>Mata-mata</span>
            <h3 id="knockout-tree-title">Caminho até a final</h3>
          </div>
          <strong>Arraste para os lados para explorar</strong>
        </div>

        <div className="knockout-tree-scroll">
          <div className="knockout-tree">
            <BracketStage title="Rodada de 32" side="left" level="round32" matches={selectMatches(round32ById, [74, 77, 73, 75, 83, 84, 81, 82])} />
            <BracketStage title="Oitavas" side="left" level="round16" matches={selectMatches(round16ById, [89, 90, 93, 94])} />
            <BracketStage title="Quartas" side="left" level="quarter" matches={selectMatches(quarterById, [97, 98])} />
            <BracketStage title="Semifinal" side="left" level="semi" matches={selectMatches(semiById, [101])} />

            <div className="bracket-final-stage">
              <span className="bracket-final-kicker">Grande final</span>
              <div className="bracket-final-trophy" aria-hidden="true">
                <img src={TACA_URL} alt="Taça da Copa do Mundo 2026" />
              </div>
              <BracketMatchCard match={bracket.rounds.final[0]} final />
              <strong>Campeão do mundo</strong>
              <small>Jogo 104</small>
            </div>

            <BracketStage title="Semifinal" side="right" level="semi" matches={selectMatches(semiById, [102])} />
            <BracketStage title="Quartas" side="right" level="quarter" matches={selectMatches(quarterById, [99, 100])} />
            <BracketStage title="Oitavas" side="right" level="round16" matches={selectMatches(round16ById, [91, 92, 95, 96])} />
            <BracketStage title="Rodada de 32" side="right" level="round32" matches={selectMatches(round32ById, [76, 78, 79, 80, 86, 88, 85, 87])} />
          </div>
        </div>
      </section>

      <p className="knockout-note">
        A ordem considera pontos, saldo de gols, gols marcados e vitórias. Enquanto houver jogos pendentes,
        qualquer resultado novo pode alterar os classificados e os confrontos projetados.
      </p>
    </section>
  );
}

function BracketStage({ title, matches, side, level }) {
  const hasPairs = matches.length > 1;
  const pairs = [];
  if (hasPairs) {
    for (let i = 0; i < matches.length; i += 2) {
      pairs.push(matches.slice(i, i + 2));
    }
  }
  return (
    <section className={`bracket-stage ${side} ${level}${hasPairs ? " has-pairs" : ""}`}>
      <h4>{title}</h4>
      <div className="bracket-stage-list">
        {hasPairs
          ? pairs.map((pair) => (
              <div className="bracket-pair" key={pair[0].id}>
                {pair.map((match) => (
                  <BracketMatchCard match={match} key={match.id} />
                ))}
              </div>
            ))
          : matches.map((match) => (
              <BracketMatchCard match={match} key={match.id} />
            ))}
      </div>
    </section>
  );
}

function BracketMatchCard({ match, final = false }) {
  return (
    <article className={`bracket-match-card${final ? " final" : ""}`}>
      <header>
        <span>Jogo {match.id}</span>
      </header>
      {[match.home, match.away].map((slot, index) => (
        <div className={`bracket-team${!slot.confirmed ? " pending" : ""}`} key={`${match.id}-${index}`}>
          {slot.confirmed ? (
            <TeamName teamId={slot.teamId} fallback={slot.name || slot.label} />
          ) : (
            <span className="bracket-pending-label">{slot.label}</span>
          )}
          <span>{index === 0 ? "A" : "B"}</span>
        </div>
      ))}
    </article>
  );
}

function WorldCupTrophy({ className, style }) {
  return (
    <svg viewBox="0 0 60 90" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className={className} style={style} aria-hidden="true">
      {/* Cup bowl */}
      <path d="M12 5 Q10 5 9 12 Q7 24 10 34 Q14 44 30 48 Q46 44 50 34 Q53 24 51 12 Q50 5 48 5 Z"/>
      {/* Left handle */}
      <path d="M12 10 C3 16 1 28 5 36 C7 42 14 44 19 40" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round"/>
      {/* Right handle */}
      <path d="M48 10 C57 16 59 28 55 36 C53 42 46 44 41 40" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round"/>
      {/* Neck */}
      <rect x="25" y="48" width="10" height="12" rx="3"/>
      {/* Left figure */}
      <ellipse cx="21" cy="67" rx="6" ry="7"/>
      <path d="M25 60 L28 56 Q28 54 26 53 Q24 52 23 54" strokeWidth="0"/>
      {/* Right figure */}
      <ellipse cx="39" cy="67" rx="6" ry="7"/>
      <path d="M35 60 L32 56 Q32 54 34 53 Q36 52 37 54" strokeWidth="0"/>
      {/* Base tiers */}
      <rect x="12" y="75" width="36" height="7" rx="2"/>
      <rect x="7" y="82" width="46" height="8" rx="3"/>
    </svg>
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
  profile_updated: "Perfil atualizado",
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
  profile_updated: "info",
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

const rootElement = document.getElementById("root");
const root = globalThis.__bolaoRoot ?? createRoot(rootElement);
globalThis.__bolaoRoot = root;
root.render(<App />);
