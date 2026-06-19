import assert from "node:assert/strict";
import test from "node:test";

import { normalizeApiFootballFixture, normalizeFixtureStatus } from "../workers/live-results/provider.js";
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
