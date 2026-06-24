import { getOfficialThirdPlaceAssignments } from "./thirdPlaceAssignments.js";

const groupSlot = (group, position) => ({ type: "group", group, position });
const thirdSlot = (eligibleGroups) => ({ type: "third", eligibleGroups });

export const ROUND_OF_32_MATCHES = [
  { id: 73, home: groupSlot("A", 2), away: groupSlot("B", 2) },
  { id: 74, home: groupSlot("E", 1), away: thirdSlot(["A", "B", "C", "D", "F"]) },
  { id: 75, home: groupSlot("F", 1), away: groupSlot("C", 2) },
  { id: 76, home: groupSlot("C", 1), away: groupSlot("F", 2) },
  { id: 77, home: groupSlot("I", 1), away: thirdSlot(["C", "D", "F", "G", "H"]) },
  { id: 78, home: groupSlot("E", 2), away: groupSlot("I", 2) },
  { id: 79, home: groupSlot("A", 1), away: thirdSlot(["C", "E", "F", "H", "I"]) },
  { id: 80, home: groupSlot("L", 1), away: thirdSlot(["E", "H", "I", "J", "K"]) },
  { id: 81, home: groupSlot("D", 1), away: thirdSlot(["B", "E", "F", "I", "J"]) },
  { id: 82, home: groupSlot("G", 1), away: thirdSlot(["A", "E", "H", "I", "J"]) },
  { id: 83, home: groupSlot("K", 2), away: groupSlot("L", 2) },
  { id: 84, home: groupSlot("H", 1), away: groupSlot("J", 2) },
  { id: 85, home: groupSlot("B", 1), away: thirdSlot(["E", "F", "G", "I", "J"]) },
  { id: 86, home: groupSlot("J", 1), away: groupSlot("H", 2) },
  { id: 87, home: groupSlot("K", 1), away: thirdSlot(["D", "E", "I", "J", "L"]) },
  { id: 88, home: groupSlot("D", 2), away: groupSlot("G", 2) }
];

export const KNOCKOUT_PATH = {
  roundOf16: [
    { id: 89, sources: [74, 77] },
    { id: 90, sources: [73, 75] },
    { id: 91, sources: [76, 78] },
    { id: 92, sources: [79, 80] },
    { id: 93, sources: [83, 84] },
    { id: 94, sources: [81, 82] },
    { id: 95, sources: [86, 88] },
    { id: 96, sources: [85, 87] }
  ],
  quarterFinals: [
    { id: 97, sources: [89, 90] },
    { id: 98, sources: [93, 94] },
    { id: 99, sources: [91, 92] },
    { id: 100, sources: [95, 96] }
  ],
  semiFinals: [
    { id: 101, sources: [97, 98] },
    { id: 102, sources: [99, 100] }
  ],
  final: [{ id: 104, sources: [101, 102] }]
};

export function compareStandingRows(a, b) {
  return (
    b.points - a.points ||
    b.goalDiff - a.goalDiff ||
    b.goalsFor - a.goalsFor ||
    b.wins - a.wins ||
    a.name.localeCompare(b.name)
  );
}

export function rankThirdPlacedTeams(groups) {
  return groups
    .map(({ group, rows }) => rows[2] ? { ...rows[2], group } : null)
    .filter(Boolean)
    .sort(compareStandingRows)
    .map((team, index) => ({ ...team, thirdPlaceRank: index + 1, qualified: index < 8 }));
}

function findThirdAssignment(selectedThirds, thirdMatches) {
  const assignments = new Map();
  const usedGroups = new Set();
  const orderedMatches = [...thirdMatches].sort((a, b) => {
    const availableA = selectedThirds.filter((team) => a.away.eligibleGroups.includes(team.group)).length;
    const availableB = selectedThirds.filter((team) => b.away.eligibleGroups.includes(team.group)).length;
    return availableA - availableB || a.id - b.id;
  });

  function assign(index) {
    if (index === orderedMatches.length) return true;
    const match = orderedMatches[index];
    const candidates = selectedThirds.filter(
      (team) => !usedGroups.has(team.group) && match.away.eligibleGroups.includes(team.group)
    );

    for (const team of candidates) {
      assignments.set(match.id, team);
      usedGroups.add(team.group);
      if (assign(index + 1)) return true;
      usedGroups.delete(team.group);
      assignments.delete(match.id);
    }
    return false;
  }

  return assign(0) ? assignments : new Map();
}

function isMathematicallyConfirmed(position, rows) {
  if (!rows || rows.length < 4 || !rows[position - 1]?.teamId) return false;
  const target = rows[position - 1];
  for (let i = position; i < 4; i++) {
    const c = rows[i];
    const maxPoints = (c?.points ?? 0) + (3 - (c?.played ?? 0)) * 3;
    if (maxPoints >= target.points) return false;
  }
  return true;
}

function resolveGroupSlot(slot, groupsByLetter) {
  const groupData = groupsByLetter.get(slot.group);
  const row = groupData?.rows?.[slot.position - 1];
  const groupDone = groupData?.rows?.length === 4 && groupData.rows.every((r) => r.played >= 3);
  const confirmed = (groupDone && !!row?.teamId) || isMathematicallyConfirmed(slot.position, groupData?.rows);
  return {
    teamId: row?.teamId ?? "",
    name: row?.name ?? "",
    label: `${slot.position}º Grupo ${slot.group}`,
    group: slot.group,
    position: slot.position,
    confirmed
  };
}

export function buildRoundOf32Bracket(groups, options = {}) {
  const groupsByLetter = new Map(groups.map((group) => [group.group, group]));
  const thirdPlacedTeams = rankThirdPlacedTeams(groups);
  const selectedThirds = thirdPlacedTeams.slice(0, 8);
  const thirdMatches = ROUND_OF_32_MATCHES.filter((match) => match.away.type === "third");
  const selectedThirdByGroup = new Map(selectedThirds.map((team) => [team.group, team]));
  const officialGroupAssignments = getOfficialThirdPlaceAssignments(selectedThirdByGroup.keys());
  const officialAssignments = new Map(
    [...officialGroupAssignments].map(([matchId, group]) => [matchId, selectedThirdByGroup.get(group)])
  );
  const thirdAssignments = officialAssignments.size === thirdMatches.length
    ? officialAssignments
    : findThirdAssignment(selectedThirds, thirdMatches);
  const standingsComplete = groups.length === 12 && groups.every(
    ({ rows }) => rows.length === 4 && rows.every((row) => row.played >= 3)
  );
  const groupsComplete = options.groupsComplete ?? standingsComplete;

  const matches = ROUND_OF_32_MATCHES.map((match) => {
    const home = resolveGroupSlot(match.home, groupsByLetter);
    const away = match.away.type === "group"
      ? resolveGroupSlot(match.away, groupsByLetter)
      : (() => {
          const team = thirdAssignments.get(match.id);
          return {
            teamId: team?.teamId ?? "",
            name: team?.name ?? "",
            label: team
              ? `3º Grupo ${team.group}`
              : `Melhor 3º (${match.away.eligibleGroups.join("/")})`,
            group: team?.group ?? "",
            position: 3,
            confirmed: groupsComplete && !!team?.teamId
          };
        })();

    return { id: match.id, home, away };
  });

  const makeFutureMatches = (matches) => matches.map((match) => ({
    id: match.id,
    home: { teamId: "", name: "", label: `Vencedor do Jogo ${match.sources[0]}` },
    away: { teamId: "", name: "", label: `Vencedor do Jogo ${match.sources[1]}` },
    sources: match.sources
  }));

  return {
    groupsComplete,
    matches,
    rounds: {
      roundOf32: matches,
      roundOf16: makeFutureMatches(KNOCKOUT_PATH.roundOf16),
      quarterFinals: makeFutureMatches(KNOCKOUT_PATH.quarterFinals),
      semiFinals: makeFutureMatches(KNOCKOUT_PATH.semiFinals),
      final: makeFutureMatches(KNOCKOUT_PATH.final)
    },
    thirdPlacedTeams,
    hasCompleteThirdAssignment: thirdAssignments.size === thirdMatches.length
  };
}
