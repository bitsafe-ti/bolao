import test from "node:test";
import assert from "node:assert/strict";
import { buildRoundOf32Bracket, rankThirdPlacedTeams } from "../src/bracket.js";

const GROUPS = "ABCDEFGHIJKL".split("");

function makeGroups({ played = 3 } = {}) {
  return GROUPS.map((group, groupIndex) => ({
    group,
    rows: [
      { teamId: `${group}-1`, name: `${group} Primeiro`, points: 9, played, wins: 3, goalsFor: 7, goalDiff: 5 },
      { teamId: `${group}-2`, name: `${group} Segundo`, points: 6, played, wins: 2, goalsFor: 5, goalDiff: 2 },
      {
        teamId: `${group}-3`,
        name: `${group} Terceiro`,
        points: 12 - groupIndex,
        played,
        wins: 1,
        goalsFor: 4,
        goalDiff: 1
      },
      { teamId: `${group}-4`, name: `${group} Quarto`, points: 0, played, wins: 0, goalsFor: 1, goalDiff: -5 }
    ]
  }));
}

test("rankThirdPlacedTeams ordena e destaca os oito melhores terceiros", () => {
  const ranking = rankThirdPlacedTeams(makeGroups());

  assert.equal(ranking.length, 12);
  assert.deepEqual(ranking.slice(0, 8).map((team) => team.group), "ABCDEFGH".split(""));
  assert.equal(ranking.filter((team) => team.qualified).length, 8);
  assert.equal(ranking[8].qualified, false);
});

test("buildRoundOf32Bracket monta os 16 confrontos sem repetir terceiros", () => {
  const bracket = buildRoundOf32Bracket(makeGroups());
  const assignedThirds = bracket.matches
    .flatMap((match) => [match.home, match.away])
    .filter((slot) => slot.position === 3);

  assert.equal(bracket.groupsComplete, true);
  assert.equal(bracket.matches.length, 16);
  assert.equal(bracket.hasCompleteThirdAssignment, true);
  assert.equal(new Set(assignedThirds.map((slot) => slot.teamId)).size, 8);
  assert.equal(bracket.matches.find((match) => match.id === 79).away.group, "H");
  assert.equal(bracket.matches.find((match) => match.id === 74).away.group, "C");
  assert.equal(bracket.matches.find((match) => match.id === 87).away.group, "D");
  assert.deepEqual(
    bracket.rounds.roundOf16.find((match) => match.id === 89).sources,
    [74, 77]
  );
  assert.deepEqual(
    bracket.rounds.final[0].sources,
    [101, 102]
  );
  assert.deepEqual(
    bracket.matches.find((match) => match.id === 73),
    {
      id: 73,
      home: { teamId: "A-2", name: "A Segundo", label: "2º Grupo A", group: "A", position: 2, confirmed: true },
      away: { teamId: "B-2", name: "B Segundo", label: "2º Grupo B", group: "B", position: 2, confirmed: true }
    }
  );
});

test("buildRoundOf32Bracket mantém o chaveamento como projeção com grupos pendentes", () => {
  const bracket = buildRoundOf32Bracket(makeGroups({ played: 2 }));
  assert.equal(bracket.groupsComplete, false);
});

test("buildRoundOf32Bracket não confirma a classificação enquanto houver jogo ao vivo", () => {
  const bracket = buildRoundOf32Bracket(makeGroups(), { groupsComplete: false });
  assert.equal(bracket.groupsComplete, false);
});
