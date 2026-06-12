import { getTeamsByGroup, worldCupTeams } from "./teams.js";
import { getVenueByGround } from "./venues.js";

export const STORAGE_KEY = "bolao-copa-2026:v1";
export const APP_VERSION = 3;

export const scoringRules = [
  { label: "Placar cravado", points: 3 },
  { label: "Ganhador correto", points: 1 },
  { label: "Palpite errado", points: 0 }
];

export const emptyPrediction = { home: "", away: "" };

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

export function scorePrediction(prediction, match) {
  const predictedHome = parseScore(prediction?.home);
  const predictedAway = parseScore(prediction?.away);
  const actualHome = parseScore(match?.homeScore);
  const actualAway = parseScore(match?.awayScore);

  if ([predictedHome, predictedAway, actualHome, actualAway].some((score) => score === null)) {
    return 0;
  }

  const predictedOutcome = getOutcome(predictedHome, predictedAway);
  const actualOutcome = getOutcome(actualHome, actualAway);

  if (predictedHome === actualHome && predictedAway === actualAway) return 3;
  if (predictedOutcome !== actualOutcome) return 0;
  if (actualOutcome === "draw") return 0;
  return 1;
}

export function calculateRanking(participants, matches, predictions) {
  return participants
    .map((participant) => {
      const perMatch = matches.map((match) => {
        const points = scorePrediction(predictions?.[participant.id]?.[match.id], match);
        return { matchId: match.id, points };
      });

      return {
        ...participant,
        total: perMatch.reduce((sum, item) => sum + item.points, 0),
        exactScores: perMatch.filter((item) => item.points === 3).length,
        winnerHits: perMatch.filter((item) => item.points === 1).length,
        scoredMatches: perMatch.filter((item) => item.points > 0).length
      };
    })
    .sort((a, b) => b.total - a.total || b.exactScores - a.exactScores || a.name.localeCompare(b.name));
}

export function normalizeEmailList(value = "") {
  const rawValue = Array.isArray(value) ? value.join(",") : value;
  return String(rawValue)
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isSuperAdminEmail(email, superAdminEmails = []) {
  return normalizeEmailList(superAdminEmails).includes(String(email ?? "").trim().toLowerCase());
}

export function normalizeUsers(users, superAdminEmails = []) {
  return users.map((user) => {
    const role = isSuperAdminEmail(user.email, superAdminEmails) ? "admin" : "user";
    return { ...user, role };
  });
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
    matches: createGroupStageMatches(),
    predictions: {},
    activeParticipantId: "",
    lastResultSyncAt: "",
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
      roundMatches.every(
        (m) =>
          m.homeScore !== "" && m.homeScore !== null && m.homeScore !== undefined &&
          m.awayScore !== "" && m.awayScore !== null && m.awayScore !== undefined
      );
    if (!allComplete) return round;
  }

  return rounds[rounds.length - 1] ?? 1;
}

export function purgeFutureRoundPredictions(state) {
  const activeRound = getActiveRound(state.matches ?? []);
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
