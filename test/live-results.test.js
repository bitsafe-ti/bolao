import assert from "node:assert/strict";
import test from "node:test";

import { fetchApiFootballResults, normalizeApiFootballFixture, normalizeEspnEvent, normalizeFixtureStatus } from "../workers/live-results/provider.js";
import { shouldSyncLiveResults } from "../workers/live-results/sync.js";
import { mergeMatchesPreservingResults } from "../functions/api/pool-state/[poolId].js";

test("normalizes API-Football live fixtures and goal events", () => {
  const fixture = normalizeApiFootballFixture({
    fixture: {
      id: 123,
      date: "2026-06-11T19:00:00+00:00",
      status: { short: "2H", elapsed: 67 },
      venue: { name: "Estadio Azteca", city: "Mexico City" }
    },
    teams: {
      home: { id: 1, name: "Mexico" },
      away: { id: 2, name: "South Africa" }
    },
    goals: { home: 1, away: 0 },
    events: [
      {
        time: { elapsed: 54, extra: null },
        team: { id: 1 },
        player: { name: "Santiago Gimenez" },
        type: "Goal",
        detail: "Normal Goal"
      }
    ]
  });

  assert.equal(fixture.homeTeamId, "mexico");
  assert.equal(fixture.awayTeamId, "south-africa");
  assert.equal(fixture.status, "live");
  assert.equal(fixture.elapsed, 67);
  assert.deepEqual(fixture.score, [1, 0]);
  assert.equal(fixture.homeGoals[0].name, "Santiago Gimenez");
});

test("maps provider statuses to application statuses", () => {
  assert.equal(normalizeFixtureStatus("NS"), "scheduled");
  assert.equal(normalizeFixtureStatus("HT"), "live");
  assert.equal(normalizeFixtureStatus("FT"), "finished");
  assert.equal(normalizeFixtureStatus("PST"), "postponed");
});

test("queries API-Football by date without the rejected league filter", async (context) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url) => {
    calls.push(new URL(url));
    return new Response(JSON.stringify({
      response: [{
        fixture: {
          id: 456,
          date: "2026-06-22T17:00:00+00:00",
          status: { short: "1H", elapsed: 24 },
          venue: { name: "AT&T Stadium", city: "Arlington" }
        },
        teams: {
          home: { id: 1, name: "Argentina" },
          away: { id: 2, name: "Austria" }
        },
        goals: { home: 1, away: 0 },
        events: []
      }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const matches = await fetchApiFootballResults({
    API_FOOTBALL_KEY: "test-key",
    API_FOOTBALL_LEAGUE_ID: "1",
    API_FOOTBALL_SEASON: "2026"
  }, new Date("2026-06-22T17:30:00.000Z"));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].searchParams.get("date"), "2026-06-22");
  assert.equal(calls[0].searchParams.has("league"), false);
  assert.equal(calls[0].searchParams.has("season"), false);
  assert.equal(matches[0].score[0], 1);
  assert.equal(matches[0].status, "live");
});

test("falls back to league and season when the date-only query is rejected", async (context) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url) => {
    calls.push(new URL(url));
    if (calls.length === 1) {
      return new Response(JSON.stringify({ errors: { request: "Invalid date query" } }), {
        status: 400,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ response: [] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  await fetchApiFootballResults({
    API_FOOTBALL_KEY: "test-key",
    API_FOOTBALL_LEAGUE_ID: "1",
    API_FOOTBALL_SEASON: "2026"
  }, new Date("2026-06-22T17:30:00.000Z"));

  assert.equal(calls.length, 2);
  assert.equal(calls[1].searchParams.get("league"), "1");
  assert.equal(calls[1].searchParams.get("season"), "2026");
});

test("normalizes ESPN live score and goal events", () => {
  const match = normalizeEspnEvent({
    id: "760456",
    date: "2026-06-22T17:00Z",
    status: {
      clock: 2700,
      type: { name: "STATUS_HALFTIME", state: "in", completed: false, shortDetail: "HT" }
    },
    competitions: [{
      venue: { fullName: "AT&T Stadium", address: { city: "Arlington, Texas" } },
      competitors: [
        { homeAway: "home", score: "1", team: { id: "202", displayName: "Argentina" } },
        { homeAway: "away", score: "0", team: { id: "474", displayName: "Austria" } }
      ],
      details: [{
        scoringPlay: true,
        clock: { displayValue: "38'" },
        team: { id: "202" },
        athletesInvolved: [{ displayName: "Lionel Messi" }],
        penaltyKick: false,
        ownGoal: false
      }]
    }]
  });

  assert.equal(match.homeTeamId, "argentina");
  assert.equal(match.awayTeamId, "austria");
  assert.deepEqual(match.score, [1, 0]);
  assert.equal(match.status, "live");
  assert.equal(match.statusShort, "HT");
  assert.equal(match.elapsed, 45);
  assert.equal(match.homeGoals[0].name, "Lionel Messi");
  assert.equal(match.homeGoals[0].minute, 38);
  assert.equal(match.resultSource, "espn");
});

test("sync window includes nearby and live matches but skips finished matches", () => {
  const now = new Date("2026-06-11T19:30:00.000Z");
  assert.equal(shouldSyncLiveResults([{ date: "2026-06-11T19:00:00.000Z", status: "live" }], now), true);
  assert.equal(shouldSyncLiveResults([{ date: "2026-06-11T19:00:00.000Z", status: "finished" }], now), false);
  assert.equal(shouldSyncLiveResults([{ date: "2026-06-12T19:00:00.000Z", status: "scheduled" }], now), false);
});

test("interprets stored kickoff times as Sao Paulo local time", () => {
  const match = { date: "2026-06-11T16:00", status: "scheduled" };
  assert.equal(shouldSyncLiveResults([match], new Date("2026-06-11T18:40:00.000Z")), true);
  assert.equal(shouldSyncLiveResults([match], new Date("2026-06-11T23:30:00.000Z")), false);
});

test("server merge preserves final results from stale client writes", () => {
  const current = [{
    id: "m1",
    homeScore: "2",
    awayScore: "1",
    status: "finished",
    resultUpdatedAt: "2026-06-11T21:00:00.000Z"
  }];
  const incoming = [{ id: "m1", homeScore: "", awayScore: "", phase: "Grupo A" }];
  const [merged] = mergeMatchesPreservingResults(current, incoming);

  assert.equal(merged.homeScore, "2");
  assert.equal(merged.awayScore, "1");
  assert.equal(merged.status, "finished");
  assert.equal(merged.phase, "Grupo A");
});

test("server merge preserves the newest live score", () => {
  const current = [{
    id: "m1",
    homeScore: "1",
    awayScore: "0",
    status: "live",
    resultUpdatedAt: "2026-06-11T20:20:00.000Z"
  }];
  const incoming = [{
    id: "m1",
    homeScore: "0",
    awayScore: "0",
    status: "live",
    resultUpdatedAt: "2026-06-11T20:10:00.000Z"
  }];
  const [merged] = mergeMatchesPreservingResults(current, incoming);
  assert.equal(merged.homeScore, "1");
});
