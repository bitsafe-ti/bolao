import { getVenueByGround } from "./venues.js";

export const RESULTS_SOURCE_URL =
  "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json";

const sourceTeamIds = {
  Algeria: "algeria",
  Argentina: "argentina",
  Australia: "australia",
  Austria: "austria",
  Belgium: "belgium",
  "Bosnia & Herzegovina": "bosnia-herzegovina",
  Brazil: "brazil",
  Canada: "canada",
  "Cape Verde": "cape-verde",
  Colombia: "colombia",
  Croatia: "croatia",
  Curacao: "curacao",
  Curaçao: "curacao",
  "Czech Republic": "czechia",
  "DR Congo": "dr-congo",
  Ecuador: "ecuador",
  Egypt: "egypt",
  England: "england",
  France: "france",
  Germany: "germany",
  Ghana: "ghana",
  Haiti: "haiti",
  Iran: "iran",
  Iraq: "iraq",
  "Ivory Coast": "ivory-coast",
  Japan: "japan",
  Jordan: "jordan",
  Mexico: "mexico",
  Morocco: "morocco",
  Netherlands: "netherlands",
  "New Zealand": "new-zealand",
  Norway: "norway",
  Panama: "panama",
  Paraguay: "paraguay",
  Portugal: "portugal",
  Qatar: "qatar",
  "Saudi Arabia": "saudi-arabia",
  Scotland: "scotland",
  Senegal: "senegal",
  "South Africa": "south-africa",
  "South Korea": "korea-republic",
  Spain: "spain",
  Sweden: "sweden",
  Switzerland: "switzerland",
  Tunisia: "tunisia",
  Turkey: "turkiye",
  Turkiye: "turkiye",
  Uruguay: "uruguay",
  USA: "united-states",
  Uzbekistan: "uzbekistan"
};

function toSaoPauloDateTime(date, time) {
  const timeMatch = time?.match(/^(\d{1,2}):(\d{2})\s+UTC([+-]\d+)/);
  if (!date || !timeMatch) return "";

  const [, hour, minute, offset] = timeMatch;
  const [year, month, day] = date.split("-").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day, Number(hour) - Number(offset), Number(minute)));
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(utcDate);
  const getPart = (type) => parts.find((part) => part.type === type)?.value;

  return `${getPart("year")}-${getPart("month")}-${getPart("day")}T${getPart("hour")}:${getPart("minute")}`;
}

function toRoundNumber(match, index) {
  if (match.group) return Math.floor((index % 6) / 2) + 1;
  const roundMatch = match.round?.match(/(\d+)/);
  return roundMatch ? Number(roundMatch[1]) : "";
}

function normalizeGoals(goals = []) {
  if (!Array.isArray(goals)) return [];

  return goals
    .filter((goal) => goal?.name)
    .map((goal) => ({
      name: goal.name,
      minute: goal.minute ?? "",
      offset: goal.offset ?? "",
      penalty: Boolean(goal.penalty),
      ownGoal: Boolean(goal.ownGoal || goal.owngoal || goal.own_goal)
    }));
}

function normalizeSourceMatch(match, index) {
  const homeTeamId = sourceTeamIds[match.team1];
  const awayTeamId = sourceTeamIds[match.team2];
  if (!homeTeamId || !awayTeamId || !match.group) return null;

  return {
    homeTeamId,
    awayTeamId,
    date: toSaoPauloDateTime(match.date, match.time),
    round: toRoundNumber(match, index),
    sourceRound: match.round,
    sourceGroup: match.group,
    ground: match.ground,
    ...getVenueByGround(match.ground),
    score: match.score?.ft,
    homeGoals: normalizeGoals(match.goals1),
    awayGoals: normalizeGoals(match.goals2)
  };
}

export async function fetchWorldCupResults() {
  const response = await fetch(`${RESULTS_SOURCE_URL}?cacheBust=${Date.now()}`);
  if (!response.ok) {
    throw new Error(`Fonte de resultados indisponível (${response.status})`);
  }

  const data = await response.json();
  return data.matches.map(normalizeSourceMatch).filter(Boolean);
}

export function applyResultUpdates(matches, sourceMatches) {
  const sourceByTeams = Object.fromEntries(
    sourceMatches.map((match) => [`${match.homeTeamId}__${match.awayTeamId}`, match])
  );
  let changed = 0;

  const nextMatches = matches.map((match) => {
    const source = sourceByTeams[`${match.homeTeamId}__${match.awayTeamId}`];
    if (!source) return match;

    const patch = {
      date: source.date || match.date,
      round: source.round || match.round,
      ground: source.ground || match.ground,
      city: source.city || match.city,
      stadium: source.stadium || match.stadium,
      country: source.country || match.country,
      sourceRound: source.sourceRound || match.sourceRound
    };

    if (Array.isArray(source.score)) {
      const homeScore = String(source.score[0]);
      const awayScore = String(source.score[1]);
      const homeGoals = source.homeGoals ?? [];
      const awayGoals = source.awayGoals ?? [];
      const resultChanged =
        match.homeScore !== homeScore ||
        match.awayScore !== awayScore ||
        JSON.stringify(match.homeGoals ?? []) !== JSON.stringify(homeGoals) ||
        JSON.stringify(match.awayGoals ?? []) !== JSON.stringify(awayGoals);

      patch.homeScore = homeScore;
      patch.awayScore = awayScore;
      patch.homeGoals = homeGoals;
      patch.awayGoals = awayGoals;
      patch.resultUpdatedAt = resultChanged ? new Date().toISOString() : match.resultUpdatedAt;
    }

    const nextMatch = { ...match, ...patch };
    if (JSON.stringify(nextMatch) !== JSON.stringify(match)) changed += 1;
    return nextMatch;
  });

  return { matches: nextMatches, changed };
}
