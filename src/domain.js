import { getTeamsByGroup, worldCupTeams } from "./teams.js";
import { getVenueByGround } from "./venues.js";
import { ROUND_OF_32_MATCHES, KNOCKOUT_STAGE_SCHEDULE, KNOCKOUT_PATH } from "./bracket.js";

export const STORAGE_KEY = "bolao-copa-2026:v1";
export const APP_VERSION = 3;

export const scoringRules = [
  { label: "Placar cravado", points: 3 },
  { label: "Ganhador ou empate correto", points: 1 },
  { label: "Palpite errado", points: 0 }
];

export const emptyPrediction = { home: "", away: "" };
export const emptyKnockoutPrediction = {
  goesToExtraTime: false,
  goesToPenalties: false,
  qualifiedSide: "",
  penaltiesHome: "",
  penaltiesAway: ""
};
export const clearedOpeningPredictionMatchIds = ["group-a-1", "group-a-2", "group-b-1", "group-d-1"];

export function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function parseScore(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) return null;
  return number;
}

export function getOutcome(home, away) {
  if (home > away) return "home";
  if (home < away) return "away";
  return "draw";
}

export function isKnockoutMatch(match) {
  return Number(match?.round) > 3;
}

export function normalizeKnockoutPrediction(prediction = {}) {
  const knockout = prediction?.knockout ?? {};
  return {
    goesToExtraTime: Boolean(knockout.goesToExtraTime),
    goesToPenalties: Boolean(knockout.goesToPenalties),
    qualifiedSide: ["home", "away"].includes(knockout.qualifiedSide) ? knockout.qualifiedSide : "",
    penaltiesHome: knockout.penaltiesHome ?? "",
    penaltiesAway: knockout.penaltiesAway ?? ""
  };
}

function isPenaltyStatus(match) {
  return [match?.status, match?.statusShort]
    .map((status) => String(status || "").toLowerCase())
    .some((status) => status === "pen" || status.includes("pen"));
}

function getPenaltyShootoutScore(match) {
  const explicitHome = parseScore(match?.penaltiesHome);
  const explicitAway = parseScore(match?.penaltiesAway);
  if (explicitHome !== null && explicitAway !== null) {
    return { home: explicitHome, away: explicitAway };
  }

  const countPenaltyGoals = (goals = []) => goals.filter((goal) => {
    const minute = Number(goal?.minute);
    return goal?.penalty && Number.isFinite(minute) && minute >= 120;
  }).length;
  const home = countPenaltyGoals(match?.homeGoals);
  const away = countPenaltyGoals(match?.awayGoals);
  return home || away ? { home, away } : null;
}

export function getKnockoutWinnerSide(match) {
  if (["home", "away"].includes(match?.qualifiedSide)) return match.qualifiedSide;
  const actualHome = parseScore(match?.homeScore);
  const actualAway = parseScore(match?.awayScore);
  if (actualHome === null || actualAway === null) return "";
  if (actualHome === actualAway) {
    const penalties = getPenaltyShootoutScore(match);
    if (!penalties || penalties.home === penalties.away) return "";
    return penalties.home > penalties.away ? "home" : "away";
  }
  return actualHome > actualAway ? "home" : "away";
}

export function getMatchKnockoutResult(match) {
  const status = String(match?.status || match?.statusShort || "").toLowerCase();
  const penalties = getPenaltyShootoutScore(match);
  const wentToPenalties = Boolean(match?.goesToPenalties) || isPenaltyStatus(match) || Boolean(penalties);
  return {
    goesToExtraTime: Boolean(match?.goesToExtraTime) || wentToPenalties || ["aet", "pen"].includes(status),
    goesToPenalties: wentToPenalties,
    qualifiedSide: getKnockoutWinnerSide(match),
    penaltiesHome: match?.penaltiesHome || penalties?.home || "",
    penaltiesAway: match?.penaltiesAway || penalties?.away || ""
  };
}

export function isMatchResultFinal(match) {
  const actualHome = parseScore(match?.homeScore);
  const actualAway = parseScore(match?.awayScore);
  if (actualHome === null || actualAway === null) return false;

  const status = String(match?.status || match?.statusShort || "").toLowerCase();
  if (!status) return true;
  if (["finished", "ft", "aet", "pen", "awd", "wo"].includes(status) || status.includes("pen")) return true;

  // If the match has scores but the status wasn't updated to a finished value
  // (e.g. sync worker stored scores while the provider returned an unexpected statusShort),
  // infer finished when kickoff time has already passed and the match is not live/postponed/cancelled.
  const notFinalStatuses = new Set([
    "live", "1h", "ht", "2h", "et", "bt", "p", "int",
    "postponed", "pst", "susp", "cancelled", "canc", "abd"
  ]);
  if (!notFinalStatuses.has(status)) {
    const kickoffTime = getMatchKickoffTime(match);
    if (kickoffTime !== null && kickoffTime <= Date.now()) return true;
  }

  return false;
}

export function isMatchLive(match) {
  const actualHome = parseScore(match?.homeScore);
  const actualAway = parseScore(match?.awayScore);
  if (actualHome === null || actualAway === null) return false;
  const status = String(match?.status || match?.statusShort || "").toLowerCase();
  return ["live", "1h", "ht", "2h", "et", "bt", "p", "int"].includes(status);
}

export function scorePredictionDetails(prediction, match) {
  const predictedHome = parseScore(prediction?.home);
  const predictedAway = parseScore(prediction?.away);
  const actualHome = parseScore(match?.homeScore);
  const actualAway = parseScore(match?.awayScore);
  const details = {
    total: 0,
    scorePoints: 0,
    qualifiedPoints: 0,
    extraTimePoints: 0,
    penaltiesPoints: 0,
    exactScore: false,
    resultHit: false,
    qualifiedHit: false,
    extraTimeHit: false,
    penaltiesHit: false
  };

  if (
    (!isMatchResultFinal(match) && !isMatchLive(match)) ||
    [predictedHome, predictedAway, actualHome, actualAway].some((score) => score === null)
  ) {
    return details;
  }

  const predictedOutcome = getOutcome(predictedHome, predictedAway);
  const actualOutcome = getOutcome(actualHome, actualAway);

  if (predictedHome === actualHome && predictedAway === actualAway) {
    details.scorePoints = 3;
    details.exactScore = true;
  } else if (predictedOutcome === actualOutcome) {
    details.scorePoints = 1;
    details.resultHit = true;
  }

  details.total = details.scorePoints + details.qualifiedPoints + details.extraTimePoints + details.penaltiesPoints;
  return details;
}

export function scorePrediction(prediction, match) {
  return scorePredictionDetails(prediction, match).total;
}

export function hasSavedPrediction(prediction) {
  return parseScore(prediction?.home) !== null && parseScore(prediction?.away) !== null;
}

function getLatestMatchId(matches, getTimestamp) {
  let latestId = null;
  let latestTimestamp = Number.NEGATIVE_INFINITY;
  for (const match of matches) {
    const timestamp = Date.parse(getTimestamp(match) || "");
    const comparableTimestamp = Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp;
    if (latestId === null || comparableTimestamp >= latestTimestamp) {
      latestId = match.id;
      latestTimestamp = comparableTimestamp;
    }
  }
  return latestId;
}

export function getPredictionScrollTargetId(matches) {
  return getLatestResultMatchId(matches);
}

export function getLatestResultMatchId(matches) {
  const liveMatches = (matches ?? []).filter(isMatchLive);
  const scoredMatches = (matches ?? []).filter((match) =>
    parseScore(match?.homeScore) !== null && parseScore(match?.awayScore) !== null
  );
  const candidates = liveMatches.length ? liveMatches : scoredMatches;
  return getLatestMatchId(candidates, (match) => match?.resultUpdatedAt || match?.updatedAt);
}

function getMatchKickoffTime(match) {
  if (!match?.date) return null;
  const time = Date.parse(match.date);
  return Number.isNaN(time) ? null : time;
}

export function hasMatchStarted(match, now = new Date()) {
  const status = String(match?.status || match?.statusShort || "").toLowerCase();
  const startedStatuses = new Set([
    "live", "1h", "ht", "2h", "et", "bt", "p", "int", "suspended",
    "finished", "ft", "aet", "pen", "awd", "wo"
  ]);
  if (startedStatuses.has(status)) return true;

  const kickoffTime = getMatchKickoffTime(match);
  if (kickoffTime === null) return false;
  return kickoffTime <= now.getTime();
}

export function isMatchClosed(match, now = new Date()) {
  if (match?.locked) return true;
  return hasMatchStarted(match, now);
}

function isLatePrediction(prediction, match, now = new Date()) {
  if (!hasSavedPrediction(prediction) || !isMatchClosed(match, now)) return false;
  const kickoffTime = getMatchKickoffTime(match);
  const savedAt = Date.parse(prediction.savedAt || prediction.updatedAt || "");
  return Number.isNaN(savedAt) || savedAt >= kickoffTime;
}

export function purgeExpiredPredictions(state, now = new Date()) {
  const matchesById = new Map((state.matches ?? []).map((match) => [match.id, match]));
  let changed = false;

  const predictions = Object.fromEntries(
    Object.entries(state.predictions ?? {}).map(([participantId, perMatch]) => {
      const filtered = Object.fromEntries(
        Object.entries(perMatch ?? {}).filter(([matchId, prediction]) => {
          const match = matchesById.get(matchId);
          const keep = !match || !isLatePrediction(prediction, match, now);
          if (!keep) changed = true;
          return keep;
        })
      );
      return [participantId, filtered];
    })
  );

  if (!changed) return state;
  return { ...state, predictions };
}

export function calculateRanking(participants, matches, predictions) {
  return participants
    .map((participant) => {
      const participantPredictions = predictions?.[participant.id] ?? {};
      const perMatch = matches.map((match) => {
        const details = isMatchResultFinal(match)
          ? scorePredictionDetails(participantPredictions?.[match.id], match)
          : { exactScore: false, resultHit: false, qualifiedHit: false };
        return { matchId: match.id, points: details.total ?? 0, details };
      });

      const totalGoalsPredicted = Object.values(participantPredictions).reduce((sum, p) => {
        const h = parseInt(p?.home, 10);
        const a = parseInt(p?.away, 10);
        return sum + (Number.isNaN(h) ? 0 : h) + (Number.isNaN(a) ? 0 : a);
      }, 0);

      return {
        ...participant,
        total: perMatch.reduce((sum, item) => sum + item.points, 0),
        exactScores: perMatch.filter((item) => item.details.exactScore).length,
        winnerHits: perMatch.filter((item) => item.details.resultHit).length,
        scoredMatches: perMatch.filter((item) => item.points > 0).length,
        predictedMatches: matches.filter((match) => hasSavedPrediction(participantPredictions?.[match.id])).length,
        totalGoalsPredicted
      };
    })
    .sort((a, b) => b.total - a.total || b.exactScores - a.exactScores || b.winnerHits - a.winnerHits || b.totalGoalsPredicted - a.totalGoalsPredicted || a.name.localeCompare(b.name));
}

export function normalizeUsers(users, superAdminEmails = new Set()) {
  return users.map((user) => ({
    ...user,
    role: user.role === "admin" || superAdminEmails.has((user.email ?? "").toLowerCase()) ? "admin" : "user"
  }));
}

function slotLabel(slot) {
  if (slot.type === "group") return `${slot.position}º Grupo ${slot.group}`;
  return `Melhor 3º dos Grupos ${slot.eligibleGroups.join("/")}`;
}

export function createKnockoutStageMatches() {
  const base = {
    date: null,
    ground: null,
    city: null,
    stadium: null,
    country: null,
    homeTeamId: null,
    awayTeamId: null,
    homeScore: "",
    awayScore: "",
    homeGoals: [],
    awayGoals: [],
    goesToExtraTime: false,
    goesToPenalties: false,
    qualifiedSide: "",
    penaltiesHome: "",
    penaltiesAway: ""
  };
  const makeScheduledMatch = (match, defaults) => {
    const schedule = KNOCKOUT_STAGE_SCHEDULE[match.id] ?? {};
    const venue = getVenueByGround(schedule.ground);
    return {
      ...base,
      ...schedule,
      ...venue,
      ...defaults,
      id: match.id
    };
  };

  return [
    ...ROUND_OF_32_MATCHES.map((m) => makeScheduledMatch(m, { phase: "16 avos", round: 4, homeSlotLabel: slotLabel(m.home), awaySlotLabel: slotLabel(m.away) })),
    ...KNOCKOUT_PATH.roundOf16.map((m) => makeScheduledMatch(m, { phase: "Oitavas de Final", round: 5, homeSlotLabel: `Vencedor do Jogo ${m.sources[0]}`, awaySlotLabel: `Vencedor do Jogo ${m.sources[1]}` })),
    ...KNOCKOUT_PATH.quarterFinals.map((m) => makeScheduledMatch(m, { phase: "Quartas de Final", round: 6, homeSlotLabel: `Vencedor do Jogo ${m.sources[0]}`, awaySlotLabel: `Vencedor do Jogo ${m.sources[1]}` })),
    ...KNOCKOUT_PATH.semiFinals.map((m) => makeScheduledMatch(m, { phase: "Semifinal", round: 7, homeSlotLabel: `Vencedor do Jogo ${m.sources[0]}`, awaySlotLabel: `Vencedor do Jogo ${m.sources[1]}` })),
    ...KNOCKOUT_PATH.thirdPlace.map((m) => makeScheduledMatch(m, { phase: "Disputa de 3º lugar", round: 8, homeSlotLabel: `Perdedor do Jogo ${m.sources[0]}`, awaySlotLabel: `Perdedor do Jogo ${m.sources[1]}` })),
    ...KNOCKOUT_PATH.final.map((m) => makeScheduledMatch(m, { phase: "Final", round: 8, homeSlotLabel: `Vencedor do Jogo ${m.sources[0]}`, awaySlotLabel: `Vencedor do Jogo ${m.sources[1]}` }))
  ];
}

export function ensureKnockoutMatches(state) {
  const knockout = createKnockoutStageMatches();
  const defaultsById = new Map(knockout.map((match) => [String(match.id), match]));
  const existingIds = new Set((state.matches ?? []).map((m) => String(m.id)));
  const missing = knockout.filter((m) => !existingIds.has(String(m.id)));
  let changed = missing.length > 0;
  const matches = (state.matches ?? []).map((match) => {
    const defaults = defaultsById.get(String(match.id));
    if (!defaults) return match;

    const next = {
      ...match,
      phase: defaults.phase,
      round: defaults.round,
      date: defaults.date,
      ground: defaults.ground,
      city: defaults.city,
      stadium: defaults.stadium,
      country: defaults.country,
      homeSlotLabel: match.homeSlotLabel ?? defaults.homeSlotLabel,
      awaySlotLabel: match.awaySlotLabel ?? defaults.awaySlotLabel
    };
    if (JSON.stringify(next) !== JSON.stringify(match)) changed = true;
    return next;
  });
  if (!changed) return state;
  return { ...state, matches: [...matches, ...missing] };
}

export function getKnockoutRoundLabel(round) {
  const labels = { 4: "16 avos", 5: "Oitavas de Final", 6: "Quartas de Final", 7: "Semifinal", 8: "Final" };
  return labels[round] ?? null;
}

export function createGroupStageMatches() {
  const defaultPairings = [
    [0, 1],
    [2, 3],
    [3, 1],
    [0, 2],
    [3, 0],
    [1, 2]
  ];
  const groupPairings = {
    A: defaultPairings,
    B: defaultPairings,
    C: defaultPairings,
    D: [[0, 1], [2, 3], [0, 2], [3, 1], [3, 0], [1, 2]],
    E: [[0, 1], [2, 3], [0, 2], [3, 1], [1, 2], [3, 0]],
    F: [[0, 1], [2, 3], [0, 2], [3, 1], [1, 2], [3, 0]],
    G: [[0, 1], [2, 3], [0, 2], [3, 1], [1, 2], [3, 0]],
    H: [[0, 1], [2, 3], [0, 2], [3, 1], [1, 2], [3, 0]],
    I: [[0, 1], [2, 3], [0, 2], [3, 1], [3, 0], [1, 2]],
    J: [[0, 1], [2, 3], [0, 2], [3, 1], [1, 2], [3, 0]],
    K: [[0, 1], [2, 3], [0, 2], [3, 1], [3, 0], [1, 2]],
    L: [[0, 1], [2, 3], [0, 2], [3, 1], [3, 0], [1, 2]]
  };
  const groupRounds = [1, 1, 2, 2, 3, 3];
  const groupKickoffs = {
    A: ["2026-06-11T16:00", "2026-06-11T23:00", "2026-06-18T13:00", "2026-06-18T22:00", "2026-06-24T22:00", "2026-06-24T22:00"],
    B: ["2026-06-12T16:00", "2026-06-13T16:00", "2026-06-18T16:00", "2026-06-18T19:00", "2026-06-24T16:00", "2026-06-24T16:00"],
    C: ["2026-06-13T19:00", "2026-06-13T22:00", "2026-06-19T19:00", "2026-06-19T21:30", "2026-06-24T19:00", "2026-06-24T19:00"],
    D: ["2026-06-12T22:00", "2026-06-14T01:00", "2026-06-19T16:00", "2026-06-20T00:00", "2026-06-25T23:00", "2026-06-25T23:00"],
    E: ["2026-06-14T14:00", "2026-06-14T20:00", "2026-06-20T17:00", "2026-06-20T21:00", "2026-06-25T17:00", "2026-06-25T17:00"],
    F: ["2026-06-14T17:00", "2026-06-14T23:00", "2026-06-20T14:00", "2026-06-21T01:00", "2026-06-25T20:00", "2026-06-25T20:00"],
    G: ["2026-06-15T16:00", "2026-06-15T22:00", "2026-06-21T16:00", "2026-06-21T22:00", "2026-06-27T00:00", "2026-06-27T00:00"],
    H: ["2026-06-15T13:00", "2026-06-15T19:00", "2026-06-21T13:00", "2026-06-21T19:00", "2026-06-26T21:00", "2026-06-26T21:00"],
    I: ["2026-06-16T16:00", "2026-06-16T19:00", "2026-06-22T18:00", "2026-06-22T21:00", "2026-06-26T16:00", "2026-06-26T16:00"],
    J: ["2026-06-16T22:00", "2026-06-17T01:00", "2026-06-22T14:00", "2026-06-23T00:00", "2026-06-27T23:00", "2026-06-27T23:00"],
    K: ["2026-06-17T14:00", "2026-06-17T23:00", "2026-06-23T14:00", "2026-06-23T23:00", "2026-06-27T20:30", "2026-06-27T20:30"],
    L: ["2026-06-17T17:00", "2026-06-17T20:00", "2026-06-23T17:00", "2026-06-23T20:00", "2026-06-27T18:00", "2026-06-27T18:00"]
  };
  const groupGrounds = {
    A: ["Mexico City", "Guadalajara (Zapopan)", "Atlanta", "Guadalajara (Zapopan)", "Mexico City", "Monterrey (Guadalupe)"],
    B: ["Toronto", "San Francisco Bay Area (Santa Clara)", "Los Angeles (Inglewood)", "Vancouver", "Vancouver", "Seattle"],
    C: ["New York/New Jersey (East Rutherford)", "Boston (Foxborough)", "Boston (Foxborough)", "Philadelphia", "Miami (Miami Gardens)", "Atlanta"],
    D: ["Los Angeles (Inglewood)", "Vancouver", "Seattle", "San Francisco Bay Area (Santa Clara)", "Los Angeles (Inglewood)", "San Francisco Bay Area (Santa Clara)"],
    E: ["Houston", "Philadelphia", "Toronto", "Kansas City", "Philadelphia", "New York/New Jersey (East Rutherford)"],
    F: ["Dallas (Arlington)", "Monterrey (Guadalupe)", "Houston", "Monterrey (Guadalupe)", "Dallas (Arlington)", "Kansas City"],
    G: ["Seattle", "Los Angeles (Inglewood)", "Los Angeles (Inglewood)", "Vancouver", "Seattle", "Vancouver"],
    H: ["Atlanta", "Miami (Miami Gardens)", "Atlanta", "Miami (Miami Gardens)", "Houston", "Guadalajara (Zapopan)"],
    I: ["New York/New Jersey (East Rutherford)", "Boston (Foxborough)", "Philadelphia", "New York/New Jersey (East Rutherford)", "Boston (Foxborough)", "Toronto"],
    J: ["Kansas City", "San Francisco Bay Area (Santa Clara)", "Dallas (Arlington)", "San Francisco Bay Area (Santa Clara)", "Kansas City", "Dallas (Arlington)"],
    K: ["Houston", "Mexico City", "Houston", "Guadalajara (Zapopan)", "Miami (Miami Gardens)", "Atlanta"],
    L: ["Dallas (Arlington)", "Toronto", "Boston (Foxborough)", "Toronto", "New York/New Jersey (East Rutherford)", "Philadelphia"]
  };
  const groups = getTeamsByGroup();

  return Object.entries(groups).flatMap(([group, teams]) =>
    groupPairings[group].map(([homeIndex, awayIndex], index) => {
      const ground = groupGrounds[group][index];
      const venue = getVenueByGround(ground);
      return {
        id: `group-${group.toLowerCase()}-${index + 1}`,
        phase: `Grupo ${group} - Rodada ${groupRounds[index]}`,
        round: groupRounds[index],
        date: groupKickoffs[group][index],
        ground,
        city: venue.city,
        stadium: venue.stadium,
        country: venue.country,
        homeTeamId: teams[homeIndex].id,
        awayTeamId: teams[awayIndex].id,
        homeScore: "",
        awayScore: "",
        homeGoals: [],
        awayGoals: []
      };
    })
  );
}

export function createInitialState() {
  return {
    version: APP_VERSION,
    users: [],
    currentUserId: "",
    participants: [],
    matches: [...createGroupStageMatches(), ...createKnockoutStageMatches()],
    predictions: {},
    auditLogs: [],
    notifications: [],
    deletedUserIds: [],
    deletedParticipantIds: [],
    activeParticipantId: "",
    lastResultSyncAt: "",
    releasedPredictionRound: 1,
    totalTeams: worldCupTeams.length
  };
}

export function getMatchRound(match) {
  if (match.round) return Number(match.round);
  const m = match.phase?.match(/Rodada\s+(\d+)/i);
  return m ? Number(m[1]) : null;
}

export function getActiveRound(matches) {
  const rounds = [
    ...new Set(
      (matches ?? []).map((m) => getMatchRound(m)).filter((r) => r !== null && !Number.isNaN(r))
    )
  ].sort((a, b) => a - b);

  for (const round of rounds) {
    const roundMatches = matches.filter((m) => getMatchRound(m) === round);
    const allComplete =
      roundMatches.length > 0 &&
      roundMatches.every(isMatchResultFinal);
    if (!allComplete) return round;
  }

  return rounds[rounds.length - 1] ?? 1;
}

export function getReleasedPredictionRound(state) {
  const automaticRound = getActiveRound(state.matches ?? []);
  const manualRound = Number(state.releasedPredictionRound);
  return Math.max(automaticRound, Number.isInteger(manualRound) && manualRound > 0 ? manualRound : 1);
}

export function purgeFutureRoundPredictions(state) {
  const activeRound = getReleasedPredictionRound(state);
  const matchRoundById = Object.fromEntries(
    (state.matches ?? []).map((m) => [m.id, getMatchRound(m)])
  );

  let changed = false;
  const cleanedPredictions = Object.fromEntries(
    Object.entries(state.predictions ?? {}).map(([participantId, perMatch]) => {
      const filtered = Object.fromEntries(
        Object.entries(perMatch ?? {}).filter(([matchId]) => {
          const round = matchRoundById[matchId];
          const keep = round === null || round <= activeRound;
          if (!keep) changed = true;
          return keep;
        })
      );
      return [participantId, filtered];
    })
  );

  if (!changed) return state;
  return { ...state, predictions: cleanedPredictions };
}

export function purgeClearedOpeningPredictions(state) {
  const matchIds = new Set(clearedOpeningPredictionMatchIds);
  let changed = false;

  const cleanedPredictions = Object.fromEntries(
    Object.entries(state.predictions ?? {}).map(([participantId, perMatch]) => {
      const filtered = Object.fromEntries(
        Object.entries(perMatch ?? {}).filter(([matchId]) => {
          const keep = !matchIds.has(matchId);
          if (!keep) changed = true;
          return keep;
        })
      );
      return [participantId, filtered];
    })
  );

  if (!changed) return state;
  return { ...state, predictions: cleanedPredictions };
}
