import assert from "node:assert/strict";
import test from "node:test";
import { calculateRanking, createGroupStageMatches, normalizeUsers, scorePrediction } from "../src/domain.js";
import { applyResultUpdates } from "../src/resultsSync.js";

test("scores exact score with three points", () => {
  assert.equal(scorePrediction({ home: 2, away: 1 }, { homeScore: 2, awayScore: 1 }), 3);
});

test("scores correct winner with one point when score is wrong", () => {
  assert.equal(scorePrediction({ home: 2, away: 1 }, { homeScore: 1, awayScore: 0 }), 1);
});

test("scores exact draw with three points", () => {
  assert.equal(scorePrediction({ home: 1, away: 1 }, { homeScore: 1, awayScore: 1 }), 3);
});

test("scores non-exact draw with zero points", () => {
  assert.equal(scorePrediction({ home: 3, away: 3 }, { homeScore: 1, awayScore: 1 }), 0);
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
