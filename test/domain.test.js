import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateRanking,
  createGroupStageMatches,
  normalizeUsers,
  purgeClearedOpeningPredictions,
  purgeExpiredPredictions,
  scorePrediction
} from "../src/domain.js";
import { applyResultUpdates } from "../src/resultsSync.js";
import { getPublicPoolState, mergePublicPoolState } from "../src/sharedState.js";

test("scores exact score with three points", () => {
  assert.equal(scorePrediction({ home: 2, away: 1 }, { homeScore: 2, awayScore: 1 }), 3);
});

test("scores correct winner with one point when score is wrong", () => {
  assert.equal(scorePrediction({ home: 2, away: 1 }, { homeScore: 1, awayScore: 0 }), 1);
});

test("scores exact draw with three points", () => {
  assert.equal(scorePrediction({ home: 1, away: 1 }, { homeScore: 1, awayScore: 1 }), 3);
});

test("scores non-exact draw with one point", () => {
  assert.equal(scorePrediction({ home: 3, away: 3 }, { homeScore: 1, awayScore: 1 }), 1);
});

test("counts non-exact draw as one-point ranking hit", () => {
  const ranking = calculateRanking(
    [{ id: "a", name: "Ana" }],
    [{ id: "m1", homeScore: 1, awayScore: 1 }],
    { a: { m1: { home: 3, away: 3 } } }
  );

  assert.equal(ranking[0].total, 1);
  assert.equal(ranking[0].winnerHits, 1);
  assert.equal(ranking[0].scoredMatches, 1);
});

test("scores wrong outcome with zero points", () => {
  assert.equal(scorePrediction({ home: 3, away: 1 }, { homeScore: 1, awayScore: 2 }), 0);
});

test("scores no points before actual result exists", () => {
  assert.equal(scorePrediction({ home: 1, away: 0 }, { homeScore: "", awayScore: "" }), 0);
});

test("orders ranking by total, exact scores, then name", () => {
  const participants = [
    { id: "b", name: "Bruno" },
    { id: "a", name: "Ana" }
  ];
  const matches = [{ id: "m1", homeScore: 1, awayScore: 0 }];
  const predictions = {
    b: { m1: { home: 2, away: 0 } },
    a: { m1: { home: 1, away: 0 } }
  };

  assert.deepEqual(
    calculateRanking(participants, matches, predictions).map((participant) => participant.name),
    ["Ana", "Bruno"]
  );
});

test("counts participants with saved predictions for pool value", () => {
  const participants = [
    { id: "a", name: "Ana" },
    { id: "b", name: "Bruno" },
    { id: "c", name: "Caio" }
  ];
  const matches = [{ id: "m1", homeScore: "", awayScore: "" }];
  const predictions = {
    a: { m1: { home: "0", away: "0" } },
    b: { m1: { home: "", away: "" } }
  };

  const ranking = calculateRanking(participants, matches, predictions);

  assert.equal(ranking.find((participant) => participant.id === "a").predictedMatches, 1);
  assert.equal(ranking.find((participant) => participant.id === "b").predictedMatches, 0);
  assert.equal(ranking.find((participant) => participant.id === "c").predictedMatches, 0);
});

test("purges predictions saved after match kickoff", () => {
  const state = {
    matches: [{ id: "m1", date: "2026-06-11T16:00:00.000Z" }],
    predictions: {
      p1: { m1: { home: "2", away: "0", savedAt: "2026-06-11T16:01:00.000Z" } }
    }
  };

  const purged = purgeExpiredPredictions(state, new Date("2026-06-12T12:00:00.000Z"));

  assert.deepEqual(purged.predictions.p1, {});
});

test("keeps predictions saved before match kickoff", () => {
  const state = {
    matches: [{ id: "m1", date: "2026-06-11T16:00:00.000Z" }],
    predictions: {
      p1: { m1: { home: "2", away: "0", savedAt: "2026-06-11T15:59:00.000Z" } }
    }
  };

  const purged = purgeExpiredPredictions(state, new Date("2026-06-12T12:00:00.000Z"));

  assert.equal(purged, state);
});

test("purges cleared opening match predictions from cached state", () => {
  const state = {
    predictions: {
      p1: {
        "group-d-1": { home: "1", away: "2", updatedAt: "2026-06-13T13:20:00.000Z" },
        "group-d-2": { home: "2", away: "0", updatedAt: "2026-06-13T13:20:00.000Z" }
      }
    }
  };

  const purged = purgeClearedOpeningPredictions(state);

  assert.deepEqual(purged.predictions.p1, {
    "group-d-2": { home: "2", away: "0", updatedAt: "2026-06-13T13:20:00.000Z" }
  });
});

test("creates group-stage schedule with dates, times and rounds", () => {
  const matches = createGroupStageMatches();

  assert.equal(matches.length, 72);
  assert.equal(matches.filter((match) => match.round === 1).length, 24);
  assert.equal(matches.filter((match) => match.round === 2).length, 24);
  assert.equal(matches.filter((match) => match.round === 3).length, 24);
  assert.ok(matches.every((match) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(match.date)));
  assert.ok(matches.every((match) => match.city && match.stadium && match.country));
});

test("normalizes only configured super admin email as admin", () => {
  const users = normalizeUsers([
    { id: "1", email: "dono@bolao.com", role: "user" },
    { id: "2", email: "outro@bolao.com", role: "admin" },
    { id: "3", email: "participante@bolao.com", role: "participant" }
  ], ["dono@bolao.com"]);

  assert.deepEqual(
    users.map((user) => user.role),
    ["admin", "user", "user"]
  );
});

test("normalizes everyone as user when no super admin email is configured", () => {
  const users = normalizeUsers([
    { id: "1", email: "primeiro@bolao.com", role: "admin" },
    { id: "2", email: "segundo@bolao.com", role: "user" }
  ]);

  assert.deepEqual(
    users.map((user) => user.role),
    ["user", "user"]
  );
});

test("syncs result goals with minute and scorer name", () => {
  const matches = [
    {
      id: "m1",
      homeTeamId: "mexico",
      awayTeamId: "south-africa",
      homeScore: "",
      awayScore: "",
      homeGoals: [],
      awayGoals: []
    }
  ];
  const sourceMatches = [
    {
      homeTeamId: "mexico",
      awayTeamId: "south-africa",
      score: [2, 0],
      homeGoals: [
        { name: "Raul Jimenez", minute: 90, offset: 2, penalty: true, ownGoal: false }
      ],
      awayGoals: []
    }
  ];

  const update = applyResultUpdates(matches, sourceMatches);

  assert.equal(update.matches[0].homeScore, "2");
  assert.deepEqual(update.matches[0].homeGoals, [
    { name: "Raul Jimenez", minute: 90, offset: 2, penalty: true, ownGoal: false }
  ]);
});

test("public shared state includes predictions, participants and match results", () => {
  const state = {
    participants: [{ id: "p1", name: "Ana" }],
    predictions: { p1: { m1: { home: "2", away: "1" } } },
    matches: [{ id: "m1", homeScore: "2", awayScore: "1" }],
    lastResultSyncAt: "2026-06-12T12:00:00.000Z",
    users: [{ id: "u1", password: "secret" }],
    deletedUserIds: ["u9"],
    deletedParticipantIds: ["p9"]
  };

  assert.deepEqual(getPublicPoolState(state), {
    users: state.users,
    participants: state.participants,
    predictions: state.predictions,
    matches: state.matches,
    lastResultSyncAt: state.lastResultSyncAt,
    deletedUserIds: state.deletedUserIds,
    deletedParticipantIds: state.deletedParticipantIds
  });
});

test("shared state merge lets remote predictions and results update local view", () => {
  const merged = mergePublicPoolState(
    {
      participants: [{ id: "p1", name: "Ana Local" }],
      predictions: { p1: { m1: { home: "1", away: "0" } } },
      matches: [{ id: "m1", homeScore: "", awayScore: "" }]
    },
    {
      participants: [{ id: "p1", name: "Ana" }, { id: "p2", name: "Bruno" }],
      predictions: { p1: { m1: { home: "2", away: "0" } }, p2: { m1: { home: "0", away: "0" } } },
      matches: [{ id: "m1", homeScore: "2", awayScore: "0" }],
      lastResultSyncAt: "2026-06-12T12:00:00.000Z"
    }
  );

  assert.equal(merged.participants.length, 2);
  assert.equal(merged.participants.find((participant) => participant.id === "p1").name, "Ana");
  assert.deepEqual(merged.predictions.p1.m1, { home: "2", away: "0" });
  assert.equal(merged.matches[0].homeScore, "2");
});

test("shared state merge preserves other users while publishing current user's latest prediction", () => {
  const merged = mergePublicPoolState(
    {
      participants: [{ id: "p1", name: "Ana", updatedAt: "2026-06-12T12:01:00.000Z" }],
      predictions: {
        p1: { m1: { home: "2", away: "1", updatedAt: "2026-06-12T12:01:00.000Z" } }
      },
      matches: []
    },
    {
      participants: [{ id: "p2", name: "Bruno", updatedAt: "2026-06-12T12:00:00.000Z" }],
      predictions: {
        p2: { m1: { home: "0", away: "0", updatedAt: "2026-06-12T12:00:00.000Z" } }
      },
      matches: []
    },
    { prefer: "current" }
  );

  assert.equal(merged.participants.length, 2);
  assert.deepEqual(merged.predictions.p1.m1.home, "2");
  assert.deepEqual(merged.predictions.p2.m1.home, "0");
});

test("shared state merge never resurrects deleted users or participants", () => {
  const merged = mergePublicPoolState(
    {
      users: [],
      participants: [],
      predictions: {},
      matches: [],
      deletedUserIds: ["u1"],
      deletedParticipantIds: ["p1"]
    },
    {
      users: [{ id: "u1", name: "Removido", participantId: "p1" }],
      participants: [{ id: "p1", name: "Removido" }],
      predictions: { p1: { m1: { home: "1", away: "0" } } },
      matches: []
    }
  );

  assert.deepEqual(merged.users, []);
  assert.deepEqual(merged.participants, []);
  assert.deepEqual(merged.predictions, {});
  assert.deepEqual(merged.deletedUserIds, ["u1"]);
  assert.deepEqual(merged.deletedParticipantIds, ["p1"]);
});
