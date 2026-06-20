import { fetchWorldCupResults, getSourceTeamId } from "../../src/resultsSync.js";

const FINISHED_STATUSES = new Set(["FT", "AET", "PEN", "AWD", "WO"]);
const LIVE_STATUSES = new Set(["1H", "HT", "2H", "ET", "BT", "P", "INT", "LIVE"]);
const POSTPONED_STATUSES = new Set(["PST", "SUSP"]);
const CANCELLED_STATUSES = new Set(["CANC", "ABD"]);

function formatSaoPauloDate(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function toSaoPauloDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export function normalizeFixtureStatus(short = "NS") {
  if (FINISHED_STATUSES.has(short)) return "finished";
  if (LIVE_STATUSES.has(short)) return "live";
  if (POSTPONED_STATUSES.has(short)) return "postponed";
  if (CANCELLED_STATUSES.has(short)) return "cancelled";
  return "scheduled";
}

function normalizeGoalEvents(events, homeProviderId, awayProviderId) {
  const goals = { home: [], away: [] };
  for (const event of events ?? []) {
    if (event?.type !== "Goal" || !event.player?.name) continue;
    const side = event.team?.id === homeProviderId ? "home" : event.team?.id === awayProviderId ? "away" : null;
    if (!side) continue;
    goals[side].push({
      name: event.player.name,
      minute: event.time?.elapsed ?? "",
      offset: event.time?.extra ?? "",
      penalty: String(event.detail || "").toLowerCase().includes("penalty"),
      ownGoal: String(event.detail || "").toLowerCase().includes("own goal")
    });
  }
  return goals;
}

export function normalizeApiFootballFixture(item) {
  const homeTeamId = getSourceTeamId(item?.teams?.home?.name);
  const awayTeamId = getSourceTeamId(item?.teams?.away?.name);
  if (!homeTeamId || !awayTeamId) return null;

  const statusShort = item.fixture?.status?.short || "NS";
  const status = normalizeFixtureStatus(statusShort);
  const homeScore = item.goals?.home;
  const awayScore = item.goals?.away;
  const hasScore = Number.isInteger(homeScore) && Number.isInteger(awayScore);
  const goals = normalizeGoalEvents(item.events, item.teams.home.id, item.teams.away.id);

  return {
    homeTeamId,
    awayTeamId,
    sourceFixtureId: item.fixture?.id ? String(item.fixture.id) : undefined,
    date: toSaoPauloDateTime(item.fixture?.date),
    ground: item.fixture?.venue?.name || "",
    city: item.fixture?.venue?.city || "",
    score: hasScore ? [homeScore, awayScore] : undefined,
    status,
    statusShort,
    elapsed: item.fixture?.status?.elapsed ?? null,
    resultSource: "api-football",
    homeGoals: goals.home,
    awayGoals: goals.away
  };
}

function getProviderError(payload) {
  const errors = payload?.errors;
  if (!errors) return "";
  if (Array.isArray(errors)) return errors.filter(Boolean).join(", ");
  if (typeof errors === "object") return Object.values(errors).filter(Boolean).join(", ");
  return String(errors);
}

async function callApiFootball(baseUrl, apiKey, params) {
  const url = new URL("fixtures", `${baseUrl.replace(/\/$/, "")}/`);
  url.search = new URLSearchParams(params).toString();
  const response = await fetch(url, {
    headers: { "x-apisports-key": apiKey },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`API-Football indisponivel (${response.status})`);
  const payload = await response.json();
  const providerError = getProviderError(payload);
  if (providerError) throw new Error(`API-Football: ${providerError}`);
  return (payload.response ?? []).map(normalizeApiFootballFixture).filter(Boolean);
}

export async function fetchApiFootballResults(env, now = new Date()) {
  const baseUrl = env.API_FOOTBALL_BASE_URL || "https://v3.football.api-sports.io";
  const league = env.API_FOOTBALL_LEAGUE_ID || "1";
  const season = env.API_FOOTBALL_SEASON || "2026";
  const date = formatSaoPauloDate(now);
  const apiKey = env.API_FOOTBALL_KEY;

  // Try with season first; if rejected (400), retry without it
  try {
    return await callApiFootball(baseUrl, apiKey, { league, season, date, timezone: "America/Sao_Paulo" });
  } catch (firstError) {
    if (!String(firstError?.message).includes("(400)")) throw firstError;
    console.warn(JSON.stringify({ message: "api-football 400 com season, retentando sem season", season }));
    return await callApiFootball(baseUrl, apiKey, { league, date, timezone: "America/Sao_Paulo" });
  }
}

export async function fetchResultSource(env, now = new Date()) {
  if (env.API_FOOTBALL_KEY) {
    let fallbackReason;
    try {
      const matches = await fetchApiFootballResults(env, now);
      if (matches.length) return { matches, source: "api-football" };
      fallbackReason = `api-football retornou 0 partidas para ${formatSaoPauloDate(now)}`;
    } catch (error) {
      fallbackReason = error instanceof Error ? error.message : String(error);
    }
    console.warn(JSON.stringify({
      message: "api-football indisponivel; usando openfootball como fallback",
      fallbackReason
    }));
    return { matches: await fetchWorldCupResults(), source: "openfootball", fallbackReason };
  }

  return { matches: await fetchWorldCupResults(), source: "openfootball" };
}
