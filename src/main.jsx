import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faEye, faTrophy, faTrash, faFutbol, faListCheck, faLayerGroup, faSitemap, faMedal, faGear, faChevronLeft, faChevronRight, faRightFromBracket, faUser, faUsers, faCalendarDays, faClipboardList, faChartSimple, faBell, faXmark } from "@fortawesome/free-solid-svg-icons";
import {
  calculateRanking,
  APP_VERSION,
  clearedOpeningPredictionMatchIds,
  createInitialState,
  emptyKnockoutPrediction,
  emptyPrediction,
  ensureKnockoutMatches,
  getActiveRound,
  getKnockoutRoundLabel,
  getMatchKnockoutResult,
  getPredictionScrollTargetId,
  getLatestResultMatchId,
  getMatchRound,
  getReleasedPredictionRound,
  hasMatchStarted,
  isKnockoutMatch,
  isMatchClosed,
  isMatchLive,
  isMatchResultFinal,
  makeId,
  normalizeUsers,
  normalizeKnockoutPrediction,
  purgeClearedOpeningPredictions,
  purgeExpiredPredictions,
  purgeFutureRoundPredictions,
  scorePrediction,
  scorePredictionDetails
} from "./domain.js";
import { getFlagUrl, getTeamsByGroup, teamsById, worldCupTeams } from "./teams.js";
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
const CACHE_SCHEMA_VERSION = String(APP_VERSION);
const LEGACY_CACHE_SCHEMA_PREFIX = `${APP_VERSION}:`;
const IS_LOCAL_ONLY_DEV = import.meta.env.DEV && !import.meta.env.VITE_API_BASE_URL;
const SHOULD_USE_POOL_CACHE = !import.meta.env.DEV || IS_LOCAL_ONLY_DEV;
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
const LOGIN_BALL_URL = `${import.meta.env.BASE_URL}favicon.png`;
const TACA_URL = `${import.meta.env.BASE_URL}taca.png`;
const TACA_PRATA_URL = `${import.meta.env.BASE_URL}taca-p.png`;
const TACA_BRONZE_URL = `${import.meta.env.BASE_URL}taca-b.png`;
const WORLD_CUP_LOGO_URL =
  "https://upload.wikimedia.org/wikipedia/commons/a/ab/2026_FIFA_World_Cup_emblem_%28horizontal_lockup%29.svg";
const LOGIN_TRANSITION_MS = 1250;

function loadSession() {
  try {
    if (import.meta.env.DEV && !IS_LOCAL_ONLY_DEV) {
      sessionStorage.removeItem(SESSION_KEY);
      return {};
    }
    const saved = sessionStorage.getItem(SESSION_KEY);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

function saveSession(updates) {
  try {
    if (import.meta.env.DEV && !IS_LOCAL_ONLY_DEV) return;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ...loadSession(), ...updates }));
  } catch {}
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function loadCachedPoolState() {
  try {
    if (!SHOULD_USE_POOL_CACHE) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    const saved = localStorage.getItem(CACHE_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    const cacheVersion = String(parsed?.cacheVersion ?? "");
    if (cacheVersion !== CACHE_SCHEMA_VERSION && !cacheVersion.startsWith(LEGACY_CACHE_SCHEMA_PREFIX)) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveCachedPoolState(state) {
  try {
    if (!SHOULD_USE_POOL_CACHE) return;
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      cacheVersion: CACHE_SCHEMA_VERSION,
      users: state.users ?? [],
      participants: state.participants ?? [],
      predictions: state.predictions ?? {},
      auditLogs: state.auditLogs ?? [],
      notifications: state.notifications ?? [],
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
    Object.keys(state?.predictions ?? {}).length ||
    state?.matches?.length
  );
}

function hasRecoverableLocalIdentity(localState, remoteState) {
  const remoteUserIds = new Set((remoteState?.users ?? []).map((user) => user.id).filter(Boolean));
  const remoteParticipantIds = new Set((remoteState?.participants ?? []).map((participant) => participant.id).filter(Boolean));
  const deletedUserIds = new Set(remoteState?.deletedUserIds ?? []);
  const deletedParticipantIds = new Set(remoteState?.deletedParticipantIds ?? []);

  return Boolean(
    (localState?.users ?? []).some((user) =>
      user?.id &&
      !remoteUserIds.has(user.id) &&
      !deletedUserIds.has(user.id) &&
      !deletedParticipantIds.has(user.participantId)
    ) ||
    (localState?.participants ?? []).some((participant) =>
      participant?.id &&
      !remoteParticipantIds.has(participant.id) &&
      !deletedParticipantIds.has(participant.id)
    )
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

async function fetchAuthoritativePoolState() {
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

  return remote;
}

const userTabs = [
  { id: "predictions", label: "Palpites", icon: faFutbol },
  { id: "results", label: "Resultados", icon: faListCheck },
  { id: "groups", label: "Grupos", icon: faLayerGroup },
  { id: "bracket", label: "Chaveamento", icon: faSitemap },
  { id: "ranking", label: "Ranking", icon: faMedal },
  { id: "rules", label: "Regras", icon: faClipboardList }
];

const adminTabs = [
  ...userTabs,
  { id: "settings", label: "Configurações", icon: faGear }
];

const settingsTabs = [
  { id: "participants", label: "Participantes", icon: faUsers },
  { id: "rounds", label: "Rodadas", icon: faCalendarDays },
  { id: "notifications", label: "Notificações", icon: faBell },
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
  return purgeClearedOpeningPredictions(purgeExpiredPredictions(purgeFutureRoundPredictions(ensureKnockoutMatches(state))));
}

function getRoundDisplayName(round) {
  const roundNumber = Number(round);
  if (roundNumber === 4) return "16 avos";
  return getKnockoutRoundLabel(roundNumber) ?? `Rodada ${round}`;
}

function getMatchPhaseDisplayName(match) {
  const round = getMatchRound(match);
  return round > 3 ? getRoundDisplayName(round) : match.phase;
}

function parseScoreValue(value) {
  if (value === "" || value === null || value === undefined) return null;
  const score = Number(value);
  return Number.isInteger(score) ? score : null;
}

function parsePredictionScoreValue(value) {
  return value === "" || value === null || value === undefined ? 0 : parseScoreValue(value);
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

const sortedWorldCupTeams = [...worldCupTeams].sort((a, b) => a.name.localeCompare(b.name));

function KnockoutMatchTeamRow({ match, onUpdate }) {
  const [editing, setEditing] = React.useState(false);
  const homeTeam = teamsById[match.homeTeamId];
  const awayTeam = teamsById[match.awayTeamId];
  const hasTeams = homeTeam && awayTeam;

  function handleSubmit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const homeTeamId = form.get("homeTeamId");
    const awayTeamId = form.get("awayTeamId");
    const date = form.get("date");
    const updates = {
      goesToExtraTime: form.has("goesToExtraTime") || form.has("goesToPenalties"),
      goesToPenalties: form.has("goesToPenalties"),
      qualifiedSide: form.get("qualifiedSide") || "",
      penaltiesHome: form.get("penaltiesHome") || "",
      penaltiesAway: form.get("penaltiesAway") || ""
    };
    if (homeTeamId) updates.homeTeamId = homeTeamId;
    if (awayTeamId) updates.awayTeamId = awayTeamId;
    if (date) updates.date = date;
    onUpdate(updates);
    setEditing(false);
  }

  return (
    <div className="knockout-match-item">
      <div className="knockout-match-teams-row">
        <span className="knockout-match-slot">{homeTeam ? homeTeam.name : match.homeSlotLabel}</span>
        <span className="knockout-match-vs">×</span>
        <span className="knockout-match-slot">{awayTeam ? awayTeam.name : match.awaySlotLabel}</span>
        {match.date && <span className="knockout-match-date">{new Date(match.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>}
        {!editing && (
          <button type="button" className="ghost" style={{ marginLeft: "auto" }} onClick={() => setEditing(true)}>
            {hasTeams ? "Editar" : "Definir times"}
          </button>
        )}
      </div>
      {editing && (
        <form onSubmit={handleSubmit} className="knockout-match-form">
          <select name="homeTeamId" defaultValue={match.homeTeamId ?? ""}>
            <option value="">Mandante ({match.homeSlotLabel})</option>
            {sortedWorldCupTeams.map((team) => (
              <option key={team.id} value={team.id}>{team.name}</option>
            ))}
          </select>
          <select name="awayTeamId" defaultValue={match.awayTeamId ?? ""}>
            <option value="">Visitante ({match.awaySlotLabel})</option>
            {sortedWorldCupTeams.map((team) => (
              <option key={team.id} value={team.id}>{team.name}</option>
            ))}
          </select>
          <input type="datetime-local" name="date" defaultValue={match.date ?? ""} />
          <label className="knockout-result-toggle">
            <input type="checkbox" name="goesToExtraTime" defaultChecked={Boolean(match.goesToExtraTime)} />
            Prorrogacao
          </label>
          <label className="knockout-result-toggle">
            <input type="checkbox" name="goesToPenalties" defaultChecked={Boolean(match.goesToPenalties)} />
            Penaltis
          </label>
          <select name="qualifiedSide" defaultValue={match.qualifiedSide ?? ""}>
            <option value="">Classificado</option>
            <option value="home">{homeTeam?.name ?? match.homeSlotLabel ?? "Mandante"}</option>
            <option value="away">{awayTeam?.name ?? match.awaySlotLabel ?? "Visitante"}</option>
          </select>
          <input type="number" name="penaltiesHome" min="0" inputMode="numeric" placeholder="Pen. mandante" defaultValue={match.penaltiesHome ?? ""} />
          <input type="number" name="penaltiesAway" min="0" inputMode="numeric" placeholder="Pen. visitante" defaultValue={match.penaltiesAway ?? ""} />
          <div style={{ display: "flex", gap: "8px" }}>
            <button type="submit">Salvar</button>
            <button type="button" className="ghost" onClick={() => setEditing(false)}>Cancelar</button>
          </div>
        </form>
      )}
    </div>
  );
}

function App() {
  const [state, setState] = useState(createInitialState);
  const [isLoading, setIsLoading] = useState(true);
  const [tab, setTab] = useState(() => { try { return sessionStorage.getItem("bol-tab") || "predictions"; } catch { return "predictions"; } });
  const [authError, setAuthError] = useState("");
  const [loginTransitionActive, setLoginTransitionActive] = useState(false);
  const [syncStatus, setSyncStatus] = useState({ state: "idle", message: "Placares automáticos ativos." });
  const [sharedStatus, setSharedStatus] = useState({ state: "idle", message: "Carregando dados do bolão..." });
  const [selectedPredictionRound, setSelectedPredictionRound] = useState(null);
  const [selectedResultRound, setSelectedResultRound] = useState(null);
  const [draftPredictions, setDraftPredictions] = useState({});
  const [pendingPredictionUpdate, setPendingPredictionUpdate] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);
  const [participantModalOpen, setParticipantModalOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState(() => { try { return sessionStorage.getItem("bol-settings-tab") || "participants"; } catch { return "participants"; } });
  const [historyContext, setHistoryContext] = useState(null);
  const [analysisContext, setAnalysisContext] = useState(null);
  const [clockNow, setClockNow] = useState(() => new Date());
  const [predictionScrollRequest, setPredictionScrollRequest] = useState(0);
  const [resultScrollRequest, setResultScrollRequest] = useState(0);
  const [notifPermission, setNotifPermission] = useState(() => {
    try { return "Notification" in window ? Notification.permission : "unsupported"; } catch { return "unsupported"; }
  });
  const [notifPanelOpen, setNotifPanelOpen] = useState(false);
  const [notifPopup, setNotifPopup] = useState(null);
  const [readNotifIds, setReadNotifIds] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("bolao-read-notifs") || "[]")); } catch { return new Set(); }
  });
  const notifRef = useRef(null);
  const shownNotifIdsRef = useRef(null);

  const notifications = (state.notifications ?? []).slice().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  const unreadCount = notifications.filter((n) => !readNotifIds.has(n.id)).length;

  function markAllRead() {
    const ids = new Set(notifications.map((n) => n.id));
    setReadNotifIds(ids);
    try { localStorage.setItem("bolao-read-notifs", JSON.stringify([...ids])); } catch {}
  }

  function markRead(id) {
    setReadNotifIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      try { localStorage.setItem("bolao-read-notifs", JSON.stringify([...next])); } catch {}
      return next;
    });
  }

  useEffect(() => {
    if (!notifPanelOpen) return;
    function handleClick(e) {
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifPanelOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [notifPanelOpen]);

  useEffect(() => {
    if (!state.currentUserId) return;
    if (shownNotifIdsRef.current === null) {
      shownNotifIdsRef.current = new Set(notifications.map((n) => n.id));
      return;
    }
    const incoming = notifications.find((n) => !shownNotifIdsRef.current.has(n.id) && !readNotifIds.has(n.id));
    if (incoming) {
      shownNotifIdsRef.current.add(incoming.id);
      setNotifPopup(incoming);
    }
  }, [notifications, state.currentUserId]);

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
    () => {
      const groupMatches = state.matches.filter((m) => { const r = getMatchRound(m); return r !== null && !Number.isNaN(r) && r <= 3; });
      return groupMatches.length > 0 && groupMatches.every(isMatchResultFinal);
    },
    [state.matches]
  );
  const knockoutBracket = useMemo(
    () => buildRoundOf32Bracket(groupStandings, { groupsComplete: groupStageComplete, matches: state.matches }),
    [groupStandings, groupStageComplete, state.matches]
  );
  const projectedKnockoutMatchesById = useMemo(() => {
    const rounds = knockoutBracket?.rounds;
    if (!rounds) return new Map();
    const bracketMatches = [
      ...rounds.roundOf32,
      ...rounds.roundOf16,
      ...rounds.quarterFinals,
      ...rounds.semiFinals,
      ...rounds.thirdPlace,
      ...rounds.final
    ];
    return new Map(bracketMatches.map((match) => [String(match.id), match]));
  }, [knockoutBracket]);
  function getDisplayMatch(match) {
    if (!isKnockoutMatch(match)) return match;
    const projected = projectedKnockoutMatchesById.get(String(match.id));
    if (!projected) return match;
    return {
      ...match,
      homeTeamId: match.homeTeamId ?? projected.home?.teamId ?? match.homeTeamId,
      awayTeamId: match.awayTeamId ?? projected.away?.teamId ?? match.awayTeamId,
      homeSlotLabel: projected.home?.label ?? match.homeSlotLabel,
      awaySlotLabel: projected.away?.label ?? match.awaySlotLabel
    };
  }
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
    .map(getDisplayMatch)
    .sort((a, b) => (a.date || "").localeCompare(b.date || "") || String(a.id).localeCompare(String(b.id)));
  const predictionScrollTargetId = useMemo(
    () => getPredictionScrollTargetId(predictionMatches),
    [predictionMatches]
  );
  const resultMatches = state.matches
    .filter((match) => getMatchRound(match) === activeResultRound)
    .map(getDisplayMatch)
    .sort((a, b) => (a.date || "").localeCompare(b.date || "") || String(a.id).localeCompare(String(b.id)));
  const resultScrollTargetId = useMemo(() => getLatestResultMatchId(resultMatches), [resultMatches]);
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
  const historyTeam = historyContext?.teamId ? teamsById[historyContext.teamId] : null;
  const historyStoredMatch = historyContext?.matchId
    ? state.matches.find((match) => match.id === historyContext.matchId)
    : null;
  const historyMatch = historyStoredMatch ? getDisplayMatch(historyStoredMatch) : historyContext?.match ?? null;
  const analysisStoredMatch = analysisContext?.matchId
    ? state.matches.find((match) => match.id === analysisContext.matchId)
    : null;
  const analysisMatch = analysisStoredMatch ? getDisplayMatch(analysisStoredMatch) : analysisContext?.match ?? null;

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

  // Auto-fill knockout teams from standings and completed knockout results
  useEffect(() => {
    if (!knockoutBracket?.matches?.length) return;
    setState((current) => {
      const bracketMatches = [
        ...knockoutBracket.rounds.roundOf32,
        ...knockoutBracket.rounds.roundOf16,
        ...knockoutBracket.rounds.quarterFinals,
        ...knockoutBracket.rounds.semiFinals,
        ...knockoutBracket.rounds.thirdPlace,
        ...knockoutBracket.rounds.final
      ];
      const bracketById = new Map(bracketMatches.map((match) => [Number(match.id), match]));
      let changed = false;
      const updatedMatches = current.matches.map((match) => {
        if (getMatchRound(match) <= 3) return match;
        const bm = bracketById.get(Number(match.id));
        if (!bm) return match;
        const homeTeamId = bm.home.confirmed && bm.home.teamId ? bm.home.teamId : null;
        const awayTeamId = bm.away.confirmed && bm.away.teamId ? bm.away.teamId : null;
        if (match.homeTeamId === homeTeamId && match.awayTeamId === awayTeamId) return match;
        changed = true;
        return { ...match, homeTeamId, awayTeamId };
      });
      if (!changed) return current;
      return { ...current, matches: updatedMatches };
    });
  }, [knockoutBracket]);

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

      if (IS_LOCAL_ONLY_DEV) {
        if (!cached) {
          setState((current) => cleanPoolState({
            ...current,
            currentUserId: session.currentUserId ?? "",
            activeParticipantId: session.activeParticipantId ?? ""
          }));
        }
        setSharedStatus({ state: "success", message: "Modo dev local: dados salvos neste navegador." });
        setIsLoading(false);
        return;
      }

      try {
        const remote = await fetchAuthoritativePoolState();

        // Migrate any data saved by the old local-first architecture
        let legacyData = null;
        try {
          const raw = localStorage.getItem(LEGACY_DATA_KEY);
          if (raw) {
            legacyData = JSON.parse(raw);
            localStorage.removeItem(LEGACY_DATA_KEY);
          }
        } catch {}

        const recoveredFromCache = cached && hasRecoverableLocalIdentity(cached, remote);
        const remoteWithCache = recoveredFromCache
          ? mergePublicPoolState(remote, cached, { prefer: "current" })
          : remote;
        const base = legacyData
          ? mergePublicPoolState(remoteWithCache, legacyData, { prefer: "current" })
          : remoteWithCache;
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

        // Only persist when migrating legacy localStorage data or recovering a local-only identity.
        // Purge-only changes are intentionally skipped here to avoid a race condition where
        // this write (with auditLogs from the initial D1 fetch) races against a concurrent
        // server update and overwrites audit log entries that were just persisted.
        // Purge is idempotent - expired predictions are removed on every client load, and the
        // next user action will persist the cleaned state via persistAndSync anyway.
        if (legacyData || recoveredFromCache) {
          try {
            const saved = await withTimeout(
              persistPoolState(cleanedBase),
              DATA_LOAD_TIMEOUT_MS,
              "Tempo excedido ao recuperar cadastro local no banco."
            );
            saveCachedPoolState(cleanPoolState(saved));
          } catch {}
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


  async function refreshPoolStateFromRemote() {
    const remote = await withTimeout(
      fetchPoolState(),
      DATA_LOAD_TIMEOUT_MS,
      "Tempo excedido ao atualizar dados do banco."
    );
    const cleanedRemote = cleanPoolState(remote);
    saveCachedPoolState(cleanedRemote);
    setState((current) => applyRemoteData(current, cleanedRemote));
    return cleanedRemote;
  }

  async function refreshPoolStateForAuth() {
    setSharedStatus({ state: "loading", message: "Atualizando dados do banco antes do login..." });
    const remote = await fetchAuthoritativePoolState();
    const cleanedRemote = cleanPoolState(remote);
    const authState = {
      ...cleanedRemote,
      users: normalizeUsers(cleanedRemote.users ?? [], SUPER_ADMIN_EMAILS)
    };
    saveCachedPoolState(authState);
    setState((current) => applyRemoteData(current, authState));
    setSharedStatus({ state: "success", message: "Dados sincronizados com o banco." });
    return authState;
  }

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
    if (tabId === "groups" || tabId === "bracket" || tabId === "results" || tabId === "ranking" || tabId === "rules") {
      refreshPoolStateFromRemote().catch(() => {});
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
    if (IS_LOCAL_ONLY_DEV) {
      setSharedStatus({ state: "success", message: "Modo dev local: dados salvos neste navegador." });
      return;
    }
    try {
      const saved = await withTimeout(
        persistPoolState(nextState),
        DATA_LOAD_TIMEOUT_MS,
        "Tempo excedido ao salvar dados no banco."
      );
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
      await refreshPoolStateFromRemote();
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

    const session = { currentUserId: user.id, activeParticipantId: participant.id };
    const nextState = appendAuditLog(
      {
        ...state,
        users: [...state.users, user],
        participants: [...state.participants, participant],
        currentUserId: user.id,
        activeParticipantId: participant.id
      },
      makeAuditEntry(cleanName, "user_registered", maskEmail(cleanEmail))
    );

    setAuthError("");
    setLoginTransitionActive(true);
    try {
      const saved = IS_LOCAL_ONLY_DEV
        ? nextState
        : await withTimeout(
            persistPoolState(nextState),
            DATA_LOAD_TIMEOUT_MS,
            "Tempo excedido ao salvar cadastro no banco."
          );
      const cleanedSaved = cleanPoolState(saved);
      const savedSessionState = cleanPoolState({
        ...cleanedSaved,
        users: normalizeUsers(cleanedSaved.users ?? [], SUPER_ADMIN_EMAILS),
        ...session
      });
      saveCachedPoolState(savedSessionState);
      await wait(LOGIN_TRANSITION_MS);
      saveSession(session);
      setState(savedSessionState);
      if (IS_LOCAL_ONLY_DEV) {
        setSharedStatus({ state: "success", message: "Modo dev local: cadastro salvo neste navegador." });
      }
    } catch (error) {
      setAuthError(`Não consegui salvar seu cadastro no banco. Tente novamente. ${error.message}`);
    } finally {
      setLoginTransitionActive(false);
    }
  }

  async function loginUser({ email, password }) {
    const cleanEmail = email.trim().toLowerCase();
    let authState = state;
    if (!IS_LOCAL_ONLY_DEV) {
      try {
        authState = await refreshPoolStateForAuth();
      } catch (error) {
        setAuthError(`Nao consegui atualizar os dados do banco para entrar. Tente novamente. ${error.message}`);
        return;
      }
    }

    const user = authState.users.find((item) => String(item.email || "").toLowerCase() === cleanEmail);
    const validPassword = user ? await verifyPassword(user, password) : false;
    if (!user || !validPassword) {
      setAuthError("E-mail ou senha inválidos.");
      return;
    }
    const session = { currentUserId: user.id, activeParticipantId: user.participantId || "" };
    let migratedUser;
    if (hasLegacyPassword(user)) {
      try {
        migratedUser = await attachPasswordCredential(user, password);
      } catch (error) {
        setAuthError(error.message);
        return;
      }
    }
    setAuthError("");
    setLoginTransitionActive(true);
    await wait(LOGIN_TRANSITION_MS);
    saveSession(session);
    const sessionState = cleanPoolState({
      ...authState,
      users: normalizeUsers(authState.users ?? [], SUPER_ADMIN_EMAILS),
      ...session
    });
    if (migratedUser) {
      const migratedState = {
        ...sessionState,
        users: sessionState.users.map((item) => (item.id === user.id ? migratedUser : item))
      };
      setState(migratedState);
      void persistAndSync(migratedState);
    } else {
      setState(sessionState);
    }
    setLoginTransitionActive(false);
  }

  function logoutUser() {
    setLoginTransitionActive(false);
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
      goesToExtraTime: false,
      goesToPenalties: false,
      qualifiedSide: "",
      penaltiesHome: "",
      penaltiesAway: "",
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
    const updates = typeof field === "object" && field !== null ? field : { [field]: value };
    updateState((current) => ({
      ...current,
      matches: current.matches.map((match) =>
        match.id === matchId ? { ...match, ...updates, updatedAt: new Date().toISOString() } : match
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
    const match = state.matches.find((item) => item.id === matchId);
    const storedPrediction = state.predictions[participantId]?.[matchId] ?? emptyPrediction;
    setDraftPredictions((current) => {
      const draft = { ...emptyPrediction, ...storedPrediction, ...current[key], [field]: value };
      return {
        ...current,
        [key]: draft
      };
    });
  }

  function commitPredictionUpdate(update) {
    if (!update) return;
    const match = state.matches.find((item) => item.id === update.matchId);
    if (!match || getMatchRound(match) > activeRound || isMatchClosed(match)) {
      setPendingPredictionUpdate(null);
      return;
    }
    updateState((current) => appendAuditLog(
      {
        ...current,
        predictions: {
          ...current.predictions,
          [update.participantId]: {
            ...current.predictions[update.participantId],
            [update.matchId]: (() => {
              const previous = current.predictions[update.participantId]?.[update.matchId];
              const previousTime = Date.parse(previous?.updatedAt || previous?.savedAt || "");
              const nextTime = Math.max(Date.now(), Number.isNaN(previousTime) ? 0 : previousTime + 1);
              const savedAt = new Date(nextTime).toISOString();
              return { ...emptyPrediction, ...previous, ...update.normalizedDraft, savedAt, updatedAt: savedAt };
            })()
          }
        }
      },
      makeAuditEntry(update.actorName, "prediction_saved", update.detail)
    ));
    setDraftPredictions((current) => {
      const next = { ...current };
      delete next[update.key];
      return next;
    });
    setPendingPredictionUpdate(null);
  }

  function savePrediction(participantId, matchId, { confirmUpdate = false } = {}) {
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
    if (isKnockoutMatch(match)) normalizedDraft.knockout = { ...emptyKnockoutPrediction };

    const participant = state.participants.find((p) => p.id === participantId);
    const actorName = participant?.name ?? currentUser?.name ?? "Participante";
    const homeTeam = teamsById[match?.homeTeamId]?.name ?? match?.homeSlotLabel ?? "?";
    const awayTeam = teamsById[match?.awayTeamId]?.name ?? match?.awaySlotLabel ?? "?";
    const detail = `${homeTeam} ${normalizedDraft.home} x ${normalizedDraft.away} ${awayTeam}`;
    const update = {
      participantId,
      matchId,
      key,
      currentPrediction,
      normalizedDraft,
      actorName,
      homeTeam,
      awayTeam,
      match,
      detail
    };

    if (confirmUpdate && hasPrediction(currentPrediction)) {
      setPendingPredictionUpdate(update);
      return;
    }

    commitPredictionUpdate(update);
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
    const roundName = getRoundDisplayName(round);
    updateState((current) => appendAuditLog(
      {
        ...current,
        releasedPredictionRound: Math.max(Number(current.releasedPredictionRound) || 1, Number(round) || 1)
      },
      makeAuditEntry(currentUser?.name ?? "Admin", "round_released", roundName)
    ));
    setSharedStatus({ state: "success", message: `${roundName} liberada para votação.` });
  }

  function lockRound(round) {
    const now = new Date().toISOString();
    const roundName = getRoundDisplayName(round);
    updateState((current) => appendAuditLog(
      {
        ...current,
        matches: current.matches.map((m) =>
          getMatchRound(m) === round ? { ...m, locked: true, updatedAt: now } : m
        )
      },
      makeAuditEntry(currentUser?.name ?? "Admin", "round_locked", roundName)
    ));
    setSharedStatus({ state: "success", message: `${roundName} travada manualmente.` });
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

  if (loginTransitionActive && !currentUser) {
    return <LoginTransitionScreen />;
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
          currentMatch={historyMatch}
          matches={state.matches}
          onClose={() => setHistoryContext(null)}
        />
      )}

      {analysisMatch && (
        <MatchAnalysisModal
          match={analysisMatch}
          matches={state.matches}
          onClose={() => setAnalysisContext(null)}
        />
      )}

      {notifPopup && (
        <NotificationPopupModal
          notification={notifPopup}
          onClose={() => setNotifPopup(null)}
          onMarkRead={() => { markRead(notifPopup.id); setNotifPopup(null); }}
        />
      )}

      {pendingPredictionUpdate && (
        <PredictionUpdateConfirmModal
          update={pendingPredictionUpdate}
          onCancel={() => setPendingPredictionUpdate(null)}
          onConfirm={() => commitPredictionUpdate(pendingPredictionUpdate)}
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
          <div className="topbar-right">
          <div style={{ position: "relative" }} ref={notifRef}>
            <button type="button" className="notif-bell-btn" aria-label="Notificações" onClick={() => setNotifPanelOpen((v) => !v)}>
              <FontAwesomeIcon icon={faBell} />
              {unreadCount > 0 && <span className="notif-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
            </button>
            {notifPanelOpen && (
              <div className="notif-panel">
                <div className="notif-panel-header">
                  <span>Notificações</span>
                  {unreadCount > 0 && <button type="button" onClick={markAllRead}>Marcar todas como lidas</button>}
                </div>
                {notifications.length === 0 ? (
                  <p className="notif-empty">Nenhuma notificação.</p>
                ) : (
                  <div className="notif-list">
                    {notifications.map((n) => (
                      <div key={n.id} className={`notif-item${readNotifIds.has(n.id) ? "" : " unread"}`} onClick={() => { setNotifPanelOpen(false); setNotifPopup(n); }}>
                        {n.imageUrl && <img src={n.imageUrl} alt="" className="notif-item-image" />}
                        <div className="notif-item-title">{n.title}</div>
                        {n.body && <div className="notif-item-body">{n.body}</div>}
                        <div className="notif-item-date">{n.createdAt ? new Date(n.createdAt).toLocaleString("pt-BR") : ""}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
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
          <div className={`settings-layout${settingsTab === "audit" ? " settings-layout-scroll" : ""}`}>
            <div className="settings-header">
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
                      const knockoutMatches = round > 3 ? roundMatches : [];
                      return (
                        <div className="round-management-row" key={round}>
                          <div className="round-management-info">
                            <strong>{getRoundDisplayName(round)}</strong>
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
                                Liberar {getRoundDisplayName(round).toLowerCase()}
                              </button>
                            )}
                            {isReleased && !isManuallyLocked && (
                              <button type="button" className="ghost danger" onClick={() => lockRound(round)}>
                                Travar {getRoundDisplayName(round).toLowerCase()}
                              </button>
                            )}
                          </div>
                          {knockoutMatches.length > 0 && (
                            <div className="knockout-match-editor-list">
                              {knockoutMatches.map((m) => (
                                <KnockoutMatchTeamRow
                                  key={m.id}
                                  match={m}
                                  onUpdate={(field, value) => updateMatch(m.id, field, value)}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className={`sync-strip ${sharedStatus.state}`}>
                    <strong>{sharedStatus.message}</strong>
                    <span>Rodada atual para palpites: {getRoundDisplayName(activeRound)}</span>
                  </div>
                </section>
              )}

              {settingsTab === "notifications" && (
                <NotificationsAdminPanel
                  notifications={state.notifications ?? []}
                  currentUser={currentUser}
                  onAdd={(notif) => {
                    setState((prev) => ({ ...prev, notifications: [notif, ...(prev.notifications ?? [])] }));
                    persistPoolState({ ...state, notifications: [notif, ...(state.notifications ?? [])] }).catch(() => {});
                  }}
                  onDelete={(id) => {
                    const next = (state.notifications ?? []).filter((n) => n.id !== id);
                    setState((prev) => ({ ...prev, notifications: next }));
                    persistPoolState({ ...state, notifications: next }).catch(() => {});
                  }}
                />
              )}
              {settingsTab === "audit" && (
                <section className="panel audit-log-panel">
                  <SectionHeader title="Logs do sistema" caption={`${state.auditLogs?.length ?? 0} / ${AUDIT_LOG_LIMIT} registros`} />
                  <AuditLogPanel logs={state.auditLogs} />
                </section>
              )}
            </div>
          </div>
        )}



        {tab === "predictions" && (
          <section className="panel predictions-panel">
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
                        ? `${getRoundDisplayName(round)} - Encerrada`
                        : round <= activeRound
                        ? `${getRoundDisplayName(round)} - Liberada`
                        : `${getRoundDisplayName(round)} - Pendente`}
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
                  {getRoundDisplayName(activePredictionRound)} ainda não está liberada. Aguarde a conclusão da {getRoundDisplayName(activeRound)}.
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
                  const homeTeamName = teamsById[match.homeTeamId]?.name ?? match.homeSlotLabel ?? match.home ?? "time da casa";
                  const awayTeamName = teamsById[match.awayTeamId]?.name ?? match.awaySlotLabel ?? match.away ?? "time visitante";
                  return (
                    <article
                      className={`match-card prediction-card ${isLocked ? "locked" : ""}`}
                      key={match.id}
                      ref={match.id === predictionScrollTargetId ? predictionTargetRef : null}
                    >
                        <div className="prediction-card-vote">
                        {predictionFeedback?.className === "exact" && <Confetti />}
                        <div className="prediction-match-info">
                          <span className="badge">{getMatchPhaseDisplayName(match)}</span>
                          <div className="prediction-teams-grid">
                            <PredictionTeamColumn
                              side="home"
                              teamId={match.homeTeamId}
                              fallback={match.homeSlotLabel ?? match.home}
                              onHistory={(teamId) => setHistoryContext({ teamId, matchId: match.id, match })}
                            />
                            <div className="prediction-center-column">
                              <span className="prediction-versus">x</span>
                              {match.homeTeamId && match.awayTeamId && (
                                <button type="button" className="ghost analysis-button" onClick={() => setAnalysisContext({ matchId: match.id, match })}>
                                  Análise
                                </button>
                              )}
                            </div>
                            <PredictionTeamColumn
                              side="away"
                              teamId={match.awayTeamId}
                              fallback={match.awaySlotLabel ?? match.away}
                              onHistory={(teamId) => setHistoryContext({ teamId, matchId: match.id, match })}
                            />
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
                              <button type="button" className="subtle" onClick={() => savePrediction(activeParticipant.id, match.id, { confirmUpdate: isSaved })}>
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
                        <p className="prediction-private-notice" role="note">
                          Os palpites dos participantes serão revelados após o início deste jogo.
                        </p>
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
                        ? `${getRoundDisplayName(round)} - Encerrada`
                        : round === automaticRound
                        ? `${getRoundDisplayName(round)} - Em andamento`
                        : `${getRoundDisplayName(round)} - Pendente`}
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

        {tab === "ranking" && <RankingTable ranking={ranking} matches={state.matches} predictions={state.predictions} currentParticipant={activeParticipant} />}

        {tab === "rules" && <GameRulesPage paidParticipants={ranking.length} />}

        <footer className="app-footer">
          <p>© 2026 Bolão Copa do Mundo · Desenvolvido por Guilherme Saraiva</p>
        </footer>
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

function LoginTransitionScreen() {
  return (
    <main className="login-transition-page" aria-live="polite" aria-busy="true">
      <div className="login-transition-orbit">
        <img src={LOGIN_BALL_URL} alt="Bolão Grupo Bit" className="login-transition-ball" />
      </div>
      <p>Entrando no bolão...</p>
    </main>
  );
}

function PredictionUpdateConfirmModal({ update, onCancel, onConfirm }) {
  return (
    <div className="modal-backdrop prediction-confirm-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="modal-card prediction-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prediction-confirm-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="prediction-confirm-heading">
          <span className="prediction-confirm-icon" aria-hidden="true">
            <FontAwesomeIcon icon={faFutbol} />
          </span>
          <div>
            <p className="eyebrow">Atualizar palpite</p>
            <h2 id="prediction-confirm-title">Confirmar novo placar?</h2>
          </div>
        </div>

        <div className="prediction-confirm-match">
          <span>{update.homeTeam}</span>
          <strong>{update.normalizedDraft.home}</strong>
          <small>x</small>
          <strong>{update.normalizedDraft.away}</strong>
          <span>{update.awayTeam}</span>
        </div>

        <div className="prediction-confirm-copy">
          <span>Palpite atual: {formatPrediction(update.currentPrediction, update.match)}</span>
          <strong>O palpite salvo sera substituido por este novo placar.</strong>
        </div>

        <div className="modal-actions prediction-confirm-actions">
          <button type="button" className="ghost" onClick={onCancel}>Cancelar</button>
          <button type="button" onClick={onConfirm}>Confirmar atualizacao</button>
        </div>
      </section>
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

    if (!IS_LOCAL_ONLY_DEV) {
      const verification = await verifyTurnstileToken(turnstileToken);
      if (!verification.success) {
        setTurnstileError(verification.message);
        setTurnstileToken("");
        setTurnstileResetKey((key) => key + 1);
        setTurnstileChecking(false);
        return;
      }
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
      <section className="auth-visual" aria-hidden="true" />
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
          {!IS_LOCAL_ONLY_DEV && (
            <TurnstileWidget
              resetKey={turnstileResetKey}
              onToken={(token) => {
                setTurnstileToken(token);
                if (token) setTurnstileError("");
              }}
            />
          )}
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

function UserAvatar({ user, large = false, protect = false }) {
  const className = `profile-avatar${large ? " large" : ""}${protect ? " protected" : ""}`;
  if (user?.avatarUrl) {
    return protect ? (
      <span
        className={className}
        aria-hidden="true"
        style={{ backgroundImage: `url(${user.avatarUrl})`, backgroundSize: "cover", backgroundPosition: "center" }}
        onContextMenu={e => e.preventDefault()}
        draggable={false}
      />
    ) : (
      <span className={className} aria-hidden="true">
        <img src={user.avatarUrl} alt="" />
      </span>
    );
  }
  return (
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
    <section className="panel profile-page" aria-label="Meu perfil">
      <p className="profile-page-intro">Atualize sua foto, seus dados de acesso e suas informações pessoais.</p>
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

function TeamHistoryModal({ team, currentMatch, matches, onClose }) {
  const hasMatchContext = Boolean(currentMatch);
  const historyBaseMatches = hasMatchContext ? getFinishedMatchesBefore(matches, currentMatch) : (matches ?? []);
  const teamMatches = historyBaseMatches
    .filter((match) => match.homeTeamId === team.id || match.awayTeamId === team.id)
    .sort((a, b) => {
      const rA = getMatchRound(a) ?? 999;
      const rB = getMatchRound(b) ?? 999;
      if (hasMatchContext) return (b.date || "").localeCompare(a.date || "") || rB - rA || String(b.id).localeCompare(String(a.id));
      return rA - rB || (a.date || "").localeCompare(b.date || "") || String(a.id).localeCompare(String(b.id));
    });

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal-card team-history-modal" role="dialog" aria-modal="true" aria-labelledby="team-history-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Histórico</p>
            <h2 id="team-history-title"><TeamName teamId={team.id} fallback={team.name} /></h2>
            {hasMatchContext && <p className="team-history-context-note">Jogos anteriores finalizados antes deste confronto.</p>}
          </div>
          <button type="button" className="modal-close" aria-label="Fechar modal" onClick={onClose}>×</button>
        </div>
        {teamMatches.length ? (
          <section className="team-history-previous">
            <h3>{hasMatchContext ? "Jogos anteriores usados como base" : "Jogos da seleção"}</h3>
            <div className="team-history-list">
            {teamMatches.map((match) => {
              const { homeScore, awayScore, statusLabel, statusClass } = getResultMeta(match);
              return (
                <article className="team-history-item" key={match.id}>
                  <div className="team-history-tags">
                    <span className="badge">{getMatchPhaseDisplayName(match)}</span>
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
          </section>
        ) : (
          <EmptyState text={hasMatchContext ? "Nenhum jogo anterior finalizado para esta seleção." : "Nenhum jogo encontrado para esta seleção."} />
        )}
      </section>
    </div>
  );
}

function MatchAnalysisModal({ match, matches, onClose }) {
  const analysis = buildMatchPossibilityAnalysis(match, matches);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal-card team-history-modal team-analysis-modal" role="dialog" aria-modal="true" aria-labelledby="match-analysis-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Análise</p>
            <h2 id="match-analysis-title">
              <TeamName teamId={match.homeTeamId} fallback={match.homeSlotLabel ?? match.home ?? "Mandante"} />
              <span className="team-analysis-title-versus">x</span>
              <TeamName teamId={match.awayTeamId} fallback={match.awaySlotLabel ?? match.away ?? "Visitante"} />
            </h2>
            <p className="team-history-context-note">Baseada apenas em jogos anteriores finalizados antes deste confronto.</p>
          </div>
          <button type="button" className="modal-close" aria-label="Fechar modal" onClick={onClose}>×</button>
        </div>
        {analysis ? (
          <MatchPossibilityAnalysis analysis={analysis} />
        ) : (
          <EmptyState text="Seleções indefinidas para análise deste confronto." />
        )}
      </section>
    </div>
  );
}

function MatchPossibilityAnalysis({ analysis, focusTeamId }) {
  const chanceRows = [
    { key: "home", label: teamsById[analysis.homeTeamId]?.name ?? "Mandante", chance: analysis.chances.home },
    { key: "draw", label: "Empate", chance: analysis.chances.draw },
    { key: "away", label: teamsById[analysis.awayTeamId]?.name ?? "Visitante", chance: analysis.chances.away }
  ];
  const homeFocused = focusTeamId === analysis.homeTeamId;
  const awayFocused = focusTeamId === analysis.awayTeamId;

  return (
    <section className="team-history-analysis" aria-label="Analise de possibilidades do jogo">
      <div className="team-history-analysis-head">
        <div>
          <p className="eyebrow">Análise do confronto</p>
          <h3>
            <span className={homeFocused ? "focused-team" : ""}><TeamName teamId={analysis.homeTeamId} fallback="Mandante" /></span>
            <span className="team-history-analysis-versus">x</span>
            <span className={awayFocused ? "focused-team" : ""}><TeamName teamId={analysis.awayTeamId} fallback="Visitante" /></span>
          </h3>
          <p className="team-history-analysis-copy">Estimativa calculada com jogos anteriores, aproveitamento, saldo de gols, forma recente e confronto direto.</p>
        </div>
        <span className="team-history-confidence">{analysis.confidenceLabel}</span>
      </div>

      <div className="team-history-chances">
        {chanceRows.map((row) => (
          <div className={`team-history-chance-row ${row.key}`} key={row.key}>
            <span>{row.label}</span>
            <div className="team-history-chance-track" aria-hidden="true">
              <span className="team-history-chance-fill" style={{ width: `${row.chance}%` }} />
            </div>
            <strong>{row.chance}%</strong>
          </div>
        ))}
      </div>

      <div className="team-history-recommendation">
        <span>Indicação</span>
        <strong>{analysis.recommendation.title}</strong>
        <p>{analysis.recommendation.description}</p>
      </div>

      <div className="team-history-stat-grid">
        <TeamHistoryStat label="Aproveitamento" value={`${analysis.homeSummary.efficiency}%`} detail={analysis.homeSummary.label} active={homeFocused} />
        <TeamHistoryStat label="Confronto" value={analysis.headToHeadLabel} detail={analysis.sampleLabel} />
        <TeamHistoryStat label="Aproveitamento" value={`${analysis.awaySummary.efficiency}%`} detail={analysis.awaySummary.label} active={awayFocused} />
      </div>

      <div className="team-history-comparison" role="table" aria-label="Comparativo dos times em jogos anteriores">
        {analysis.comparisonRows.map((row) => (
          <div className="team-history-comparison-row" role="row" key={row.label}>
            <strong role="cell">{row.home}</strong>
            <span role="cell">{row.label}</span>
            <strong role="cell">{row.away}</strong>
          </div>
        ))}
      </div>

      <div className="team-history-form-grid">
        <TeamRecentFormSummary label={teamsById[analysis.homeTeamId]?.name ?? "Mandante"} form={analysis.homeSummary.recentForm} active={homeFocused} />
        <TeamRecentFormSummary label={teamsById[analysis.awayTeamId]?.name ?? "Visitante"} form={analysis.awaySummary.recentForm} active={awayFocused} />
      </div>

      <ul className="team-history-insights">
        {analysis.insights.map((insight) => <li key={insight}>{insight}</li>)}
      </ul>
    </section>
  );
}

function TeamHistoryStat({ label, value, detail, active = false }) {
  return (
    <div className={`team-history-stat ${active ? "active" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function TeamRecentFormSummary({ label, form, active = false }) {
  return (
    <div className={`team-history-form ${active ? "active" : ""}`}>
      <span>{label}</span>
      {form.length ? (
        <div className="team-history-form-chips">
          {form.map((item) => (
            <span className={`team-history-form-chip ${item.className}`} title={item.title} key={item.id}>
              {item.result}
            </span>
          ))}
        </div>
      ) : (
        <strong>Sem jogos anteriores</strong>
      )}
    </div>
  );
}

function buildMatchPossibilityAnalysis(match, matches = []) {
  const homeTeamId = match?.homeTeamId;
  const awayTeamId = match?.awayTeamId;
  if (!homeTeamId || !awayTeamId) return null;

  const previousMatches = getFinishedMatchesBefore(matches, match);
  const headToHeadMatches = previousMatches.filter((item) => {
    const ids = [item.homeTeamId, item.awayTeamId];
    return ids.includes(homeTeamId) && ids.includes(awayTeamId);
  });
  const homeSummary = summarizeTeamHistory(homeTeamId, previousMatches);
  const awaySummary = summarizeTeamHistory(awayTeamId, previousMatches);
  const homeH2h = summarizeTeamHistory(homeTeamId, headToHeadMatches);
  const awayH2h = summarizeTeamHistory(awayTeamId, headToHeadMatches);
  const homeRating = getTeamHistoryRating(homeSummary);
  const awayRating = getTeamHistoryRating(awaySummary);
  const headToHeadAdjustment = getHeadToHeadAdjustment(homeH2h, awayH2h);
  const chances = calculateMatchChances(homeRating + headToHeadAdjustment, awayRating - headToHeadAdjustment, {
    hasSample: homeSummary.played > 0 || awaySummary.played > 0
  });
  const homeName = teamsById[homeTeamId]?.name ?? "Mandante";
  const awayName = teamsById[awayTeamId]?.name ?? "Visitante";
  const sampleSize = previousMatches.filter((item) => (
    item.homeTeamId === homeTeamId ||
    item.awayTeamId === homeTeamId ||
    item.homeTeamId === awayTeamId ||
    item.awayTeamId === awayTeamId
  )).length;

  return {
    homeTeamId,
    awayTeamId,
    homeSummary: toDisplaySummary(homeSummary),
    awaySummary: toDisplaySummary(awaySummary),
    chances,
    confidenceLabel: sampleSize >= 6 ? "Base forte" : sampleSize >= 3 ? "Base moderada" : "Base inicial",
    headToHeadLabel: headToHeadMatches.length
      ? `${homeH2h.wins}-${homeH2h.draws}-${awayH2h.wins}`
      : "Sem jogos",
    sampleLabel: `${sampleSize} jogo${sampleSize === 1 ? "" : "s"} na base`,
    comparisonRows: buildComparisonRows(homeSummary, awaySummary),
    recommendation: buildMatchRecommendation({ homeName, awayName, homeSummary, awaySummary, chances, sampleSize }),
    insights: buildMatchInsights({
      homeName,
      awayName,
      homeSummary,
      awaySummary,
      chances,
      headToHeadMatches
    })
  };
}

function getFinishedMatchesBefore(matches, currentMatch) {
  const currentTime = Date.parse(currentMatch?.date || "");
  return (matches ?? []).filter((match) => {
    if (!match || match.id === currentMatch?.id || !isMatchResultFinal(match)) return false;
    if (!match.homeTeamId || !match.awayTeamId) return false;
    const matchTime = Date.parse(match.date || "");
    if (!Number.isNaN(currentTime) && !Number.isNaN(matchTime)) return matchTime < currentTime;
    return true;
  });
}

function summarizeTeamHistory(teamId, matches) {
  const summary = {
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    points: 0,
    recentPoints: 0,
    recentPlayed: 0,
    recentForm: []
  };
  const sortedMatches = [...matches].sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  for (const match of sortedMatches) {
    if (match.homeTeamId !== teamId && match.awayTeamId !== teamId) continue;
    const homeScore = parseScoreValue(match.homeScore);
    const awayScore = parseScoreValue(match.awayScore);
    if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore)) continue;
    const isHome = match.homeTeamId === teamId;
    const goalsFor = isHome ? homeScore : awayScore;
    const goalsAgainst = isHome ? awayScore : homeScore;
    const points = goalsFor > goalsAgainst ? 3 : goalsFor === goalsAgainst ? 1 : 0;

    summary.played += 1;
    summary.goalsFor += goalsFor;
    summary.goalsAgainst += goalsAgainst;
    summary.points += points;
    if (points === 3) summary.wins += 1;
    else if (points === 1) summary.draws += 1;
    else summary.losses += 1;
  }

  const recentMatches = sortedMatches
    .filter((match) => match.homeTeamId === teamId || match.awayTeamId === teamId)
    .slice(-3);
  for (const match of recentMatches) {
    const homeScore = parseScoreValue(match.homeScore);
    const awayScore = parseScoreValue(match.awayScore);
    if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore)) continue;
    const isHome = match.homeTeamId === teamId;
    const goalsFor = isHome ? homeScore : awayScore;
    const goalsAgainst = isHome ? awayScore : homeScore;
    const result = goalsFor > goalsAgainst ? "V" : goalsFor === goalsAgainst ? "E" : "D";
    summary.recentPlayed += 1;
    summary.recentPoints += goalsFor > goalsAgainst ? 3 : goalsFor === goalsAgainst ? 1 : 0;
    summary.recentForm.push({
      id: match.id,
      result,
      className: result === "V" ? "win" : result === "E" ? "draw" : "loss",
      title: `${result} ${goalsFor} x ${goalsAgainst} em ${formatDate(match.date)}`
    });
  }

  return summary;
}

function toDisplaySummary(summary) {
  const efficiency = summary.played ? Math.round((summary.points / (summary.played * 3)) * 100) : 50;
  const goalDiff = summary.goalsFor - summary.goalsAgainst;
  return {
    ...summary,
    efficiency,
    goalDiff,
    goalsForAverage: summary.played ? summary.goalsFor / summary.played : 0,
    goalsAgainstAverage: summary.played ? summary.goalsAgainst / summary.played : 0,
    label: summary.played
      ? `${summary.wins}V ${summary.draws}E ${summary.losses}D, saldo ${goalDiff >= 0 ? "+" : ""}${goalDiff}`
      : "Sem jogos finalizados"
  };
}

function buildComparisonRows(homeSummary, awaySummary) {
  const homeDisplay = toDisplaySummary(homeSummary);
  const awayDisplay = toDisplaySummary(awaySummary);
  return [
    { label: "Aproveitamento", home: `${homeDisplay.efficiency}%`, away: `${awayDisplay.efficiency}%` },
    { label: "Gols feitos/jogo", home: formatDecimal(homeDisplay.goalsForAverage), away: formatDecimal(awayDisplay.goalsForAverage) },
    { label: "Gols sofridos/jogo", home: formatDecimal(homeDisplay.goalsAgainstAverage), away: formatDecimal(awayDisplay.goalsAgainstAverage) },
    { label: "Saldo", home: formatSignedNumber(homeDisplay.goalDiff), away: formatSignedNumber(awayDisplay.goalDiff) }
  ];
}

function buildMatchRecommendation({ homeName, awayName, homeSummary, awaySummary, chances, sampleSize }) {
  if (!sampleSize) {
    return {
      title: "Sem favorito pela base atual",
      description: "Ainda nao ha jogos anteriores finalizados suficientes. Use a analise como ponto de partida e avalie o contexto do confronto."
    };
  }

  const chanceDiff = chances.home - chances.away;
  const drawRelevant = chances.draw >= 30;
  if (Math.abs(chanceDiff) <= 7) {
    return {
      title: "Tendencia de jogo equilibrado",
      description: drawRelevant
        ? "O empate aparece forte na leitura, mas uma vitoria apertada para qualquer lado ainda e plausivel."
        : "Os indicadores estao proximos. Vale analisar gols sofridos e forma recente antes de definir o palpite."
    };
  }

  const favoriteName = chanceDiff > 0 ? homeName : awayName;
  const favoriteSummary = chanceDiff > 0 ? homeSummary : awaySummary;
  const otherSummary = chanceDiff > 0 ? awaySummary : homeSummary;
  const advantage = Math.abs(chanceDiff) >= 16 ? "boa vantagem" : "leve vantagem";
  const reason = (favoriteSummary.goalsFor - favoriteSummary.goalsAgainst) >= (otherSummary.goalsFor - otherSummary.goalsAgainst)
    ? "melhor saldo na base anterior"
    : "melhor aproveitamento recente";

  return {
    title: `${favoriteName} com ${advantage}`,
    description: `A base aponta ${favoriteName} como tendencia pelo ${reason}. Nao ha sugestao de placar exato, apenas direcao para apoiar o voto.`
  };
}

function getTeamHistoryRating(summary) {
  if (!summary.played) return 0;
  const pointsRate = summary.points / (summary.played * 3);
  const recentRate = summary.recentPlayed ? summary.recentPoints / (summary.recentPlayed * 3) : pointsRate;
  const goalDiffPerGame = (summary.goalsFor - summary.goalsAgainst) / summary.played;
  return ((pointsRate - 0.5) * 1.35) + (Math.tanh(goalDiffPerGame / 2) * 0.55) + ((recentRate - 0.5) * 0.45);
}

function getHeadToHeadAdjustment(homeSummary, awaySummary) {
  const played = Math.max(homeSummary.played, awaySummary.played);
  if (!played) return 0;
  const homeRate = homeSummary.points / Math.max(1, homeSummary.played * 3);
  const awayRate = awaySummary.points / Math.max(1, awaySummary.played * 3);
  return (homeRate - awayRate) * 0.22;
}

function calculateMatchChances(homeRating, awayRating, { hasSample }) {
  if (!hasSample) return { home: 35, draw: 30, away: 35 };
  const diff = homeRating - awayRating;
  const closeFactor = 1 - Math.min(Math.abs(diff) / 1.7, 1);
  const draw = Math.round(clampNumber(22 + (closeFactor * 10), 16, 34));
  const decisivePool = 100 - draw;
  const homeShare = 1 / (1 + Math.exp(-diff * 1.35));
  const home = Math.round(decisivePool * homeShare);
  return { home, draw, away: 100 - draw - home };
}

function buildMatchInsights({ homeName, awayName, homeSummary, awaySummary, chances, headToHeadMatches }) {
  const insights = [];
  const chanceDiff = chances.home - chances.away;
  if (Math.abs(chanceDiff) <= 7) {
    insights.push("Cenario equilibrado: o historico registrado nao abre vantagem clara para nenhum lado.");
  } else {
    insights.push(`${chanceDiff > 0 ? homeName : awayName} chega com maior possibilidade pelo desempenho registrado ate aqui.`);
  }

  const homeAvgGoals = homeSummary.played ? homeSummary.goalsFor / homeSummary.played : 0;
  const awayAvgGoals = awaySummary.played ? awaySummary.goalsFor / awaySummary.played : 0;
  if (homeSummary.played || awaySummary.played) {
    const attackLeader = homeAvgGoals >= awayAvgGoals ? homeName : awayName;
    insights.push(`${attackLeader} tem a melhor media ofensiva na base usada para esta analise.`);
  } else {
    insights.push("Ainda nao ha jogos finalizados suficientes, entao a leitura inicial parte de um confronto neutro.");
  }

  insights.push(headToHeadMatches.length
    ? `Confronto direto considerado em ${headToHeadMatches.length} jogo${headToHeadMatches.length === 1 ? "" : "s"} anterior${headToHeadMatches.length === 1 ? "" : "es"}.`
    : "Sem confronto direto anterior registrado antes deste jogo.");
  return insights;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatDecimal(value) {
  return Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function formatSignedNumber(value) {
  const number = Number(value || 0);
  return `${number > 0 ? "+" : ""}${number}`;
}

function Flag({ team }) {
  return <img className="flag" src={getFlagUrl(team)} alt={`Bandeira: ${team.name}`} loading="lazy" />;
}

function SectionHeader({ title, caption, titleId }) {
  return <header className="section-header"><h2 id={titleId}>{title}</h2>{caption && <p>{caption}</p>}</header>;
}

function getMatchSideName(match, side) {
  if (side === "home") return teamsById[match?.homeTeamId]?.name ?? match?.homeSlotLabel ?? match?.home ?? "Mandante";
  return teamsById[match?.awayTeamId]?.name ?? match?.awaySlotLabel ?? match?.away ?? "Visitante";
}

function MatchSideTeam({ match, side }) {
  const teamId = side === "home" ? match?.homeTeamId : match?.awayTeamId;
  const fallback = side === "home"
    ? match?.homeSlotLabel ?? match?.home ?? "Mandante"
    : match?.awaySlotLabel ?? match?.away ?? "Visitante";
  return <TeamName teamId={teamId} fallback={fallback} />;
}

function ScoreInput({ label, value, onChange, disabled = false }) {
  const current = Math.max(0, parseInt(value, 10) || 0);
  return (
    <div className={`score-stepper${disabled ? " score-stepper-disabled" : ""}`} aria-label={label}>
      <button type="button" className="score-stepper-btn" disabled={disabled || current <= 0} onClick={() => onChange(String(current - 1))} aria-label="Diminuir">−</button>
      <span className="score-stepper-value">{current}</span>
      <button type="button" className="score-stepper-btn" disabled={disabled} onClick={() => onChange(String(current + 1))} aria-label="Aumentar">+</button>
    </div>
  );
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

function RankingTable({ ranking, matches = [], predictions = {}, compact = false, currentParticipant = null }) {
  const paidParticipants = ranking.length;
  const totalPoolValue = paidParticipants * ENTRY_FEE;
  const displayedRanking = ranking;
  const rankOffset = 0;
  const hasLiveMatches = matches.some(isMatchLive);
  const [auditParticipant, setAuditParticipant] = useState(null);
  const [statsParticipant, setStatsParticipant] = useState(null);
  return (
    <section className="panel table-panel">
      {compact && <SectionHeader title="Top 5" />}
      {hasLiveMatches && (
        <div className="live-ranking-notice">
          <span className="live-dot" /> Pontuação parcial ao vivo — atualiza a cada 30s
        </div>
      )}
      {!compact && <PrizePodium ranking={ranking} totalPoolValue={totalPoolValue} />}
      {displayedRanking.length ? (
        <div className="table-wrap">
          <table className="ranking-table">
            <thead><tr><th>Colocação</th><th>Participante</th><th>Pontos</th><th>Cravados</th><th>Acertos 1 pt</th><th>Jogos pontuados</th>{!compact && <th>Stats</th>}{!compact && <th>Auditoria</th>}</tr></thead>
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
                      <UserAvatar user={participant} protect />
                      <span>{participant.name}</span>
                    </div>
                  </td>
                  <td><strong className="points-pill">{participant.total}</strong></td>
                  <td>{participant.exactScores}</td>
                  <td>{participant.winnerHits}</td>
                  <td>{participant.scoredMatches}</td>
                  {!compact && (
                    <td className="audit-cell">
                      <button type="button" className="audit-eye-btn" onClick={() => setStatsParticipant({ participant, position: rankOffset + index + 1 })} aria-label={`Ver estatísticas de ${participant.name}`} title="Estatísticas">
                        <FontAwesomeIcon icon={faChartSimple} />
                      </button>
                    </td>
                  )}
                  {!compact && (
                    <td className="audit-cell">
                      <button type="button" className="audit-eye-btn" onClick={() => setAuditParticipant(participant)} aria-label={`Ver auditoria de ${participant.name}`} title="Auditoria de palpites">
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
      {statsParticipant && (
        <ParticipantStatsModal
          participant={statsParticipant.participant}
          position={statsParticipant.position}
          matches={matches}
          predictions={predictions}
          onClose={() => setStatsParticipant(null)}
        />
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

function GameRulesPage({ paidParticipants = 0 }) {
  const totalPoolValue = paidParticipants * ENTRY_FEE;
  return (
    <section className="panel rules-panel">
      <div className="ranking-details rules-details">
        <div className="ranking-summary rules-metrics">
          <div className="rules-metric-card rules-metric-card-fee">
            <span>Valor por participante</span>
            <strong>{formatCurrency(ENTRY_FEE)}</strong>
          </div>
          <div className="rules-metric-card rules-metric-card-total">
            <span>Total arrecadado</span>
            <strong>{formatCurrency(totalPoolValue)}</strong>
          </div>
          <div className="rules-metric-card rules-metric-card-players">
            <span>Apostadores</span>
            <strong>{paidParticipants}</strong>
          </div>
        </div>
        <ScoringExamples />
        <KnockoutRulesSection />
        <RuleSummaryCards />
      </div>
    </section>
  );
}

function RuleSummaryCards() {
  return (
    <section className="rules-block" aria-labelledby="general-rules-title">
      <div className="rules-block-heading">
        <span>Regras gerais</span>
        <strong id="general-rules-title">Prazo, desempate e premiacao</strong>
      </div>
      <div className="rules-summary-cards">
      <article className="rule-summary-card rule-summary-card-danger">
        <div className="rule-summary-card-heading">
          <span>Restri&ccedil;&atilde;o de voto</span>
        </div>
        <div className="rule-summary-card-body">
          <strong className="rule-summary-card-title">Ajuste de palpites ap&oacute;s o prazo</strong>
          <p>
            Depois que o voto estiver restrito pelo in&iacute;cio do jogo, bloqueio manual da rodada ou encerramento do prazo,
            palpites s&oacute; poder&atilde;o ser ajustados mediante evid&ecirc;ncia de erro do sistema.
          </p>
          <ul>
            <li>O participante deve apresentar a evid&ecirc;ncia do erro para an&aacute;lise administrativa.</li>
            <li>A altera&ccedil;&atilde;o deve corrigir apenas o impacto comprovado pelo erro identificado.</li>
            <li>Sem evid&ecirc;ncia de falha do sistema, o palpite registrado permanece v&aacute;lido.</li>
          </ul>
        </div>
      </article>
      <article className="rule-summary-card rule-summary-card-criteria">
        <div className="rule-summary-card-heading">
          <span>Crit&eacute;rios de desempate</span>
        </div>
        <div className="rule-summary-card-body">
          <strong className="rule-summary-card-title">Se houver empate na pontua&ccedil;&atilde;o final</strong>
          <ol>
            <li><strong>1</strong><span>Maior n&uacute;mero de placares cravados.</span></li>
            <li><strong>2</strong><span>Maior n&uacute;mero de acertos de 1 ponto.</span></li>
            <li><strong>3</strong><span>Maior total de gols palpitados no torneio.</span></li>
            <li><strong>4</strong><span>Persistindo o empate, prevalece a ordem alfab&eacute;tica.</span></li>
          </ol>
        </div>
      </article>
      <article className="rule-summary-card rule-summary-card-prize">
        <div className="rule-summary-card-heading">
          <span>Premia&ccedil;&atilde;o final</span>
        </div>
        <div className="rule-summary-card-body">
          <strong className="rule-summary-card-title">O valor acumulado ser&aacute; dividido entre os tr&ecirc;s primeiros colocados ao final do campeonato.</strong>
          <ol>
            <li><strong>1&ordm;</strong><span>50% do total arrecadado.</span></li>
            <li><strong>2&ordm;</strong><span>30% do total arrecadado.</span></li>
            <li><strong>3&ordm;</strong><span>20% do total arrecadado.</span></li>
          </ol>
        </div>
      </article>
      </div>
    </section>
  );
}

function KnockoutRulesSection() {
  return (
    <section className="knockout-rules-section" aria-labelledby="knockout-rules-title">
      <div className="knockout-rules-heading">
        <span>Mata-mata</span>
        <strong id="knockout-rules-title">Como funcionam os palpites eliminatorios</strong>
        <p>O mata-mata segue a regra original de placar, vencedor ou empate. A prorrogacao e identificada automaticamente pelo resultado oficial.</p>
      </div>
      <div className="knockout-rules-grid">
        <article className="knockout-rule-card">
          <span>1</span>
          <strong>Placar do jogo</strong>
          <p>O participante informa o placar final da partida. Se houver prorrogacao, os gols da prorrogacao contam no placar.</p>
        </article>
        <article className="knockout-rule-card">
          <span>2</span>
          <strong>Prorrogacao</strong>
          <p>O participante nao seleciona prorrogacao. O sistema identifica pela situacao do jogo e usa o placar final ate 120 minutos.</p>
        </article>
        <article className="knockout-rule-card">
          <span>3</span>
          <strong>Penaltis</strong>
          <p>A disputa de penaltis nao entra no palpite e nao altera o placar cravado. O placar considerado vai ate o fim da prorrogacao.</p>
        </article>
      </div>
      <div className="knockout-rules-example">
        <strong>Exemplo</strong>
        <p>Palpite 2 x 1. Se o jogo terminar 2 x 1 apos a prorrogacao, soma 3 pontos pelo placar cravado. Se terminar 1 x 1 e for aos penaltis, o placar considerado continua 1 x 1.</p>
      </div>
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
  const latestAuditCardRef = useRef(null);
  const participantPredictions = predictions[participant.id] ?? {};
  const scoredMatches = matches
    .filter((match) => isMatchResultFinal(match) || isMatchLive(match))
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    .map((match) => {
      const prediction = participantPredictions[match.id];
      const points = scorePrediction(prediction, match);
      const details = scorePredictionDetails(prediction, match);
      return { match, prediction, points, details };
    });
  const latestScoredMatchId = scoredMatches.at(-1)?.match.id ?? "";
  const total = scoredMatches.reduce((sum, r) => sum + r.points, 0);

  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!latestScoredMatchId || !latestAuditCardRef.current) return undefined;
    const frameId = window.requestAnimationFrame(() => {
      latestAuditCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [latestScoredMatchId, participant.id]);

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
              {scoredMatches.map(({ match, prediction, points, details }, index) => {
                const hasParticipantPrediction = hasPrediction(prediction);
                const isBlocked = !hasParticipantPrediction && clearedOpeningPredictionMatchIds.includes(match.id);
                const isExact = details.exactScore;
                const isHit = points > 0;
                const resultLabel = isExact
                  ? "Placar exato"
                  : isHit
                    ? "Resultado correto"
                    : hasParticipantPrediction ? "Não pontuou" : isBlocked ? "Bloqueado" : "Sem palpite";

                return (
                  <article
                    key={match.id}
                    ref={match.id === latestScoredMatchId ? latestAuditCardRef : null}
                    className={`audit-game-card audit-game-card-${isExact ? "exact" : isHit ? "winner" : isBlocked ? "blocked" : hasParticipantPrediction ? "miss" : "noprediction"}`}
                  >
                    {isExact && <Confetti />}
                    <div className="audit-game-card-header">
                      <span>Jogo {String(index + 1).padStart(2, "0")}</span>
                      <span className={`audit-card-result audit-card-result-${isExact ? "exact" : isHit ? "winner" : isBlocked ? "blocked" : "miss"}`}>
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
                        <strong>{formatMatchResult(match)}</strong>
                      </div>
                      <div className="audit-card-stat">
                        <span>Palpite</span>
                        <strong className={!hasParticipantPrediction ? "audit-no-prediction" : ""}>
                          {hasParticipantPrediction ? formatPrediction(prediction, match) : "— x —"}
                        </strong>
                      </div>
                      <div className="audit-card-stat audit-card-points">
                        <span>Pontos</span>
                        <strong className={`points-pill ${isExact ? "exact" : isHit ? "winner" : ""}`}>{points}</strong>
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

function formatMatchResult(match) {
  const home = match?.homeScore === "" || match?.homeScore === undefined ? "-" : match.homeScore;
  const away = match?.awayScore === "" || match?.awayScore === undefined ? "-" : match.awayScore;
  if (!isKnockoutMatch(match)) return `${home} x ${away}`;
  const knockout = getMatchKnockoutResult(match);
  const qualifiedName = knockout.qualifiedSide ? getMatchSideName(match, knockout.qualifiedSide) : "";
  const extras = [
    qualifiedName ? `classificado: ${qualifiedName}` : "",
    knockout.goesToPenalties
      ? `penaltis ${knockout.penaltiesHome || "-"} x ${knockout.penaltiesAway || "-"}`
      : knockout.goesToExtraTime ? "prorrogacao" : ""
  ].filter(Boolean);
  return extras.length ? `${home} x ${away} (${extras.join(", ")})` : `${home} x ${away}`;
}

function isPenaltyDecision(match) {
  const statuses = [match?.status, match?.statusShort]
    .map((status) => String(status || "").toLowerCase())
    .filter(Boolean);
  return Boolean(match?.goesToPenalties) || statuses.some((status) => status === "pen" || status.includes("pen"));
}

function getPenaltyShootoutScore(match) {
  if (!isPenaltyDecision(match)) return null;
  const explicitHome = parseScoreValue(match?.penaltiesHome);
  const explicitAway = parseScoreValue(match?.penaltiesAway);
  if (explicitHome !== null && explicitAway !== null) {
    return { home: explicitHome, away: explicitAway };
  }

  const shootoutGoals = (goals = []) => goals.filter((goal) => {
    const minute = Number(goal?.minute);
    return goal?.penalty && Number.isFinite(minute) && minute >= 120;
  }).length;
  const home = shootoutGoals(match?.homeGoals);
  const away = shootoutGoals(match?.awayGoals);
  if (home || away) return { home, away };
  return { home: "-", away: "-" };
}

function ResultKnockoutBreakdown({ match }) {
  if (!isKnockoutMatch(match) || !isMatchResultFinal(match)) return null;
  const home = match?.homeScore === "" || match?.homeScore === undefined ? "-" : match.homeScore;
  const away = match?.awayScore === "" || match?.awayScore === undefined ? "-" : match.awayScore;
  const penaltyScore = getPenaltyShootoutScore(match);
  const knockout = getMatchKnockoutResult(match);
  const qualifiedName = knockout.qualifiedSide ? getMatchSideName(match, knockout.qualifiedSide) : "";

  if (!penaltyScore && !knockout.goesToExtraTime && !qualifiedName) return null;

  return (
    <div className="result-knockout-breakdown" aria-label="Detalhes do resultado de mata-mata">
      <span className="result-breakdown-item">
        <span>Partida</span>
        <strong>{home} x {away}</strong>
      </span>
      {penaltyScore ? (
        <span className="result-breakdown-item penalty">
          <span>Penaltis</span>
          <strong>{penaltyScore.home} x {penaltyScore.away}</strong>
        </span>
      ) : knockout.goesToExtraTime ? (
        <span className="result-breakdown-item">
          <span>Decisao</span>
          <strong>Prorrogacao</strong>
        </span>
      ) : null}
      {qualifiedName && (
        <span className="result-breakdown-item qualified">
          <span>Classificado</span>
          <strong>{qualifiedName}</strong>
        </span>
      )}
    </div>
  );
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
          <span className="badge">{getMatchPhaseDisplayName(match)}</span>
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
        <ResultKnockoutBreakdown match={match} />
        <div className="result-user-prediction">
          <span>Seu palpite</span>
          <strong>{hasPrediction(userPrediction) ? formatPrediction(userPrediction, match) : "Sem palpite"}</strong>
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
      </div>
      {offeredPredictions.length ? (
        <div className="participant-prediction-list">
          <div className="participant-prediction-table-header" aria-hidden="true">
            <span>Nome</span>
            <span>Palpite</span>
            <span>Pontos</span>
          </div>
          {offeredPredictions.map(({ participant, prediction }) => {
            const feedback = getPredictionFeedback(prediction, match, { compact: true });
            return (
              <article className="participant-prediction-card" key={participant.id}>
                <div className="participant-prediction-person">
                  <UserAvatar user={participant} protect />
                  <strong>{participant.name}</strong>
                </div>
                <ParticipantPredictionSummary prediction={prediction} match={match} />
                {feedback ? (
                  <span className={`prediction-feedback-pill compact ${feedback.className}`} title={feedback.description ?? feedback.label}>
                    {feedback.label}
                  </span>
                ) : (
                  <span className="prediction-feedback-muted">Aguardando</span>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="prediction-overview-empty">
          <span aria-hidden="true">0</span>
          <strong>Nenhum palpite registrado</strong>
          <p>Os palpites aparecem aqui assim que algum participante salvar este jogo.</p>
        </div>
      )}
    </div>
  );
}

function ParticipantPredictionSummary({ prediction, match }) {
  if (!hasPrediction(prediction)) {
    return <span className="participant-prediction-empty">Sem palpite</span>;
  }

  return (
    <span className="prediction-pill participant-prediction-score">
      {prediction.home} x {prediction.away}
    </span>
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

  const details = scorePredictionDetails(prediction, match);
  const points = details.total;
  if (details.exactScore) {
    return {
      label: options.compact ? `+${points}` : `Voce cravou +${points} pts`,
      description: "Cravou o placar",
      className: "exact"
    };
  }
  if (points > 0) {
    const predictedHome = parseScoreValue(prediction.home);
    const predictedAway = parseScoreValue(prediction.away);
    const isDrawHit = predictedHome === predictedAway && actualHome === actualAway;
    const description = isDrawHit ? "Acertou o empate" : "Acertou o vencedor";
    return {
      label: options.compact
        ? `+${points}`
        : `${description} +${points} pt${points > 1 ? "s" : ""}`,
      description,
      className: "hit"
    };
  }
  return {
    label: options.compact ? "0" : "Você não pontuou",
    description: "Não pontuou",
    className: "miss"
  };
}

function formatPrediction(prediction, match = null) {
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
              <UserAvatar user={participant ?? { name: "Aguardando participante" }} protect />
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
    <section className="rules-block" aria-labelledby="scoring-rules-title">
      <div className="rules-block-heading">
        <span>Pontuacao</span>
        <strong id="scoring-rules-title">Como os pontos sao calculados</strong>
      </div>
      <div className="scoring-examples">
      <div className="scoring-card scoring-card-primary">
        <div className="scoring-card-header">
          <strong>3</strong>
          <span>pontos</span>
        </div>
        <div className="scoring-card-copy">
          <strong>Placar cravado</strong>
          <span>Palpite e resultado idênticos — inclusive em empates. Ex: palpite 1 x 1, resultado 1 x 1.</span>
        </div>
      </div>
      <div className="scoring-card scoring-card-winner">
        <div className="scoring-card-header">
          <strong>1</strong>
          <span>ponto</span>
        </div>
        <div className="scoring-card-copy">
          <strong>Vencedor correto</strong>
          <span>Acertou quem venceu, mesmo sem cravar o placar.</span>
        </div>
      </div>
      <div className="scoring-card scoring-card-draw">
        <div className="scoring-card-header">
          <strong>1</strong>
          <span>ponto</span>
        </div>
        <div className="scoring-card-copy">
          <strong>Empate correto</strong>
          <span>Palpite e resultado foram empate, com placar diferente.</span>
        </div>
      </div>
      <div className="scoring-card scoring-card-winner">
        <div className="scoring-card-header">
          <strong>3</strong>
          <span>pontos</span>
        </div>
        <div className="scoring-card-copy">
          <strong>Mata-mata</strong>
          <span>Placar cravado considera gols da prorrogacao. Penaltis nao entram no placar nem na pontuacao.</span>
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
    </section>
  );
}

function NotificationPopupModal({ notification, onClose, onMarkRead }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box notif-popup" onClick={(e) => e.stopPropagation()}>
        <div className="notif-popup-header">
          <FontAwesomeIcon icon={faBell} />
          <span>Nova notificação</span>
          <button type="button" className="modal-close" aria-label="Fechar" onClick={onClose}>
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </div>
        {notification.imageUrl && (
          <img src={notification.imageUrl} alt="" className="notif-popup-image" />
        )}
        <div className="notif-popup-title">{notification.title}</div>
        {notification.body && <div className="notif-popup-body">{notification.body}</div>}
        {notification.createdAt && (
          <div className="notif-popup-date">{new Date(notification.createdAt).toLocaleString("pt-BR")}</div>
        )}
        <div className="notif-popup-actions">
          <button type="button" onClick={onMarkRead}>Marcar como lido</button>
          <button type="button" className="ghost" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

function NotificationsAdminPanel({ notifications, currentUser, onAdd, onDelete }) {
  const sorted = [...notifications].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  function handleSubmit(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const title = (fd.get("title") || "").trim();
    const body = (fd.get("body") || "").trim();
    const imageUrl = (fd.get("imageUrl") || "").trim();
    if (!title) return;
    onAdd({
      id: makeId("notif"),
      title,
      body,
      imageUrl: imageUrl || undefined,
      createdAt: new Date().toISOString(),
      authorId: currentUser.id,
      authorName: currentUser.name
    });
    e.target.reset();
  }

  return (
    <section className="panel">
      <SectionHeader title="Notificações" caption="Visíveis a todos os participantes" />
      <form className="notif-admin-form" onSubmit={handleSubmit}>
        <input name="title" placeholder="Título da notificação" required maxLength={120} />
        <textarea name="body" placeholder="Mensagem (opcional)" rows={3} maxLength={600} />
        <input name="imageUrl" placeholder="URL da imagem (opcional)" type="url" maxLength={500} />
        <button type="submit">Publicar notificação</button>
      </form>
      {sorted.length === 0 ? (
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Nenhuma notificação publicada.</p>
      ) : (
        <div className="notif-admin-list">
          {sorted.map((n) => (
            <div key={n.id} className="notif-admin-item">
              <div className="notif-admin-item-body">
                <div className="notif-admin-item-title">{n.title}</div>
                {n.body && <div className="notif-admin-item-text">{n.body}</div>}
                {n.imageUrl && <div className="notif-admin-item-text" style={{ fontSize: "0.75rem", wordBreak: "break-all" }}>🖼 {n.imageUrl}</div>}
                <div className="notif-admin-item-date">
                  {n.createdAt ? new Date(n.createdAt).toLocaleString("pt-BR") : ""}
                  {n.authorName ? ` · ${n.authorName}` : ""}
                </div>
              </div>
              <button
                type="button"
                className="ghost danger"
                style={{ flexShrink: 0 }}
                onClick={() => onDelete(n.id)}
                aria-label="Remover notificação"
              >
                <FontAwesomeIcon icon={faTrash} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
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
        <li><strong>3</strong><span>Maior total de gols palpitados no torneio.</span></li>
        <li><strong>4</strong><span>Persistindo o empate, prevalece a ordem alfabética.</span></li>
      </ol>
    </div>
  );
}

function ParticipantStatsModal({ participant, position, matches, predictions, onClose }) {
  const participantPredictions = predictions[participant.id] ?? {};
  const rounds = {};
  for (const match of matches) {
    const round = getMatchRound(match);
    if (!round) continue;
    if (!rounds[round]) rounds[round] = { points: 0, exact: 0, winner: 0, miss: 0, scored: 0 };
    const pred = participantPredictions[match.id];
    if (!isMatchResultFinal(match)) continue;
    const details = scorePredictionDetails(pred, match);
    const pts = details.total;
    rounds[round].scored++;
    rounds[round].points += pts;
    if (details.exactScore) rounds[round].exact++;
    else if (details.resultHit) rounds[round].winner++;
    else rounds[round].miss++;
  }
  const allScored = Object.values(rounds).reduce((s, r) => s + r.scored, 0);
  const allExact = Object.values(rounds).reduce((s, r) => s + r.exact, 0);
  const allWinner = Object.values(rounds).reduce((s, r) => s + r.winner, 0);
  const allMiss = Object.values(rounds).reduce((s, r) => s + r.miss, 0);
  const approx = allScored > 0 ? Math.round((allExact + allWinner) / allScored * 100) : 0;
  const sortedRounds = Object.entries(rounds).sort((a, b) => Number(a[0]) - Number(b[0]));
  const bestRound = [...sortedRounds].sort((a, b) => b[1].points - a[1].points)[0]?.[0];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box stats-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose}>×</button>
        <div className="stats-modal-header">
          <UserAvatar user={participant} />
          <div>
            <h2>{participant.name}</h2>
            <p className="stats-subtitle">{participant.total} pts · {approx}% de aproveitamento</p>
          </div>
        </div>
        <div className="stats-overview-grid">
          <div className="stats-tile stats-tile-exact"><strong>{allExact}</strong><span>Cravados</span></div>
          <div className="stats-tile stats-tile-winner"><strong>{allWinner}</strong><span>Acertos 1pt</span></div>
          <div className="stats-tile stats-tile-miss"><strong>{allMiss}</strong><span>Erros</span></div>
          <div className="stats-tile stats-tile-rate"><strong>{approx}%</strong><span>Aproveitamento</span></div>
        </div>
        {sortedRounds.length > 0 && (
          <div className="table-wrap">
            <table className="stats-rounds-table">
              <thead><tr><th>Rodada</th><th>Pts</th><th>Cravados</th><th>1pt</th><th>Erros</th></tr></thead>
              <tbody>
                {sortedRounds.map(([round, r]) => (
                  <tr key={round} className={bestRound === round ? "stats-best-round" : ""}>
                    <td>{getRoundDisplayName(Number(round))}{bestRound === round && <span className="stats-best-badge">melhor</span>}</td>
                    <td><strong>{r.points}</strong></td>
                    <td>{r.exact}</td>
                    <td>{r.winner}</td>
                    <td>{r.miss}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="stats-goals-line">Total de gols palpitados: <strong>{participant.totalGoalsPredicted ?? "—"}</strong></p>
      </div>
    </div>
  );
}

function GroupStandingsBoard({ groups }) {
  return (
    <section className="panel">
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
            <BracketStage title="16 AVOS" side="left" level="round32" matches={selectMatches(round32ById, [74, 77, 73, 75, 83, 84, 81, 82])} />
            <BracketStage title="Oitavas" side="left" level="round16" matches={selectMatches(round16ById, [89, 90, 93, 94])} />
            <BracketStage title="Quartas" side="left" level="quarter" matches={selectMatches(quarterById, [97, 98])} />
            <BracketStage title="Semifinal" side="left" level="semi" matches={selectMatches(semiById, [101])} />

            <div className="bracket-final-stage">
              <div className="bracket-final-content">
                <div className="bracket-final-heading">
                  <span className="bracket-final-kicker">Grande final</span>
                  <div className="bracket-final-trophy" aria-hidden="true">
                    <img src={TACA_URL} alt="Taça da Copa do Mundo 2026" />
                  </div>
                  <BracketChampionCard finalMatch={bracket.rounds.final[0]} />
                </div>
                <BracketMatchCard match={bracket.rounds.final[0]} final />
              </div>
            </div>

            <BracketStage title="Semifinal" side="right" level="semi" matches={selectMatches(semiById, [102])} />
            <BracketStage title="Quartas" side="right" level="quarter" matches={selectMatches(quarterById, [99, 100])} />
            <BracketStage title="Oitavas" side="right" level="round16" matches={selectMatches(round16ById, [91, 92, 95, 96])} />
            <BracketStage title="16 AVOS" side="right" level="round32" matches={selectMatches(round32ById, [76, 78, 79, 80, 86, 88, 85, 87])} />
          </div>
        </div>
      </section>

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
        {match.pending && match.date && (
          <span className="bracket-match-date">
            {new Date(match.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
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

function BracketChampionCard({ finalMatch }) {
  const winner = finalMatch.winner ?? finalMatch.champion;

  return (
    <article className="bracket-champion-card">
      <header>Campeão do mundo</header>
      <div className={`bracket-champion-team${!winner?.confirmed ? " pending" : ""}`}>
        {winner?.confirmed ? (
          <TeamName teamId={winner.teamId} fallback={winner.name || winner.label} />
        ) : (
          <span>Vencedor do Jogo {finalMatch.id}</span>
        )}
      </div>
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
  const allLogs = (logs ?? []).filter((log) => !log.internalOnly);
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
