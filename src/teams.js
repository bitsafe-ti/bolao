export const worldCupTeams = [
  { id: "mexico", name: "México", fifaName: "Mexico", group: "A", flagCode: "mx" },
  { id: "south-africa", name: "África do Sul", fifaName: "South Africa", group: "A", flagCode: "za" },
  { id: "korea-republic", name: "Coreia do Sul", fifaName: "Korea Republic", group: "A", flagCode: "kr" },
  { id: "czechia", name: "Tchéquia", fifaName: "Czechia", group: "A", flagCode: "cz" },
  { id: "canada", name: "Canadá", fifaName: "Canada", group: "B", flagCode: "ca" },
  { id: "bosnia-herzegovina", name: "Bósnia e Herzegovina", fifaName: "Bosnia and Herzegovina", group: "B", flagCode: "ba" },
  { id: "qatar", name: "Catar", fifaName: "Qatar", group: "B", flagCode: "qa" },
  { id: "switzerland", name: "Suíça", fifaName: "Switzerland", group: "B", flagCode: "ch" },
  { id: "brazil", name: "Brasil", fifaName: "Brazil", group: "C", flagCode: "br" },
  { id: "morocco", name: "Marrocos", fifaName: "Morocco", group: "C", flagCode: "ma" },
  { id: "haiti", name: "Haiti", fifaName: "Haiti", group: "C", flagCode: "ht" },
  { id: "scotland", name: "Escócia", fifaName: "Scotland", group: "C", flagCode: "gb-sct" },
  { id: "united-states", name: "Estados Unidos", fifaName: "United States", group: "D", flagCode: "us" },
  { id: "paraguay", name: "Paraguai", fifaName: "Paraguay", group: "D", flagCode: "py" },
  { id: "australia", name: "Austrália", fifaName: "Australia", group: "D", flagCode: "au" },
  { id: "turkiye", name: "Turquia", fifaName: "Turkiye", group: "D", flagCode: "tr" },
  { id: "germany", name: "Alemanha", fifaName: "Germany", group: "E", flagCode: "de" },
  { id: "curacao", name: "Curaçao", fifaName: "Curacao", group: "E", flagCode: "cw" },
  { id: "ivory-coast", name: "Costa do Marfim", fifaName: "Ivory Coast", group: "E", flagCode: "ci" },
  { id: "ecuador", name: "Equador", fifaName: "Ecuador", group: "E", flagCode: "ec" },
  { id: "netherlands", name: "Países Baixos", fifaName: "Netherlands", group: "F", flagCode: "nl" },
  { id: "japan", name: "Japão", fifaName: "Japan", group: "F", flagCode: "jp" },
  { id: "sweden", name: "Suécia", fifaName: "Sweden", group: "F", flagCode: "se" },
  { id: "tunisia", name: "Tunísia", fifaName: "Tunisia", group: "F", flagCode: "tn" },
  { id: "belgium", name: "Bélgica", fifaName: "Belgium", group: "G", flagCode: "be" },
  { id: "egypt", name: "Egito", fifaName: "Egypt", group: "G", flagCode: "eg" },
  { id: "iran", name: "Irã", fifaName: "Iran", group: "G", flagCode: "ir" },
  { id: "new-zealand", name: "Nova Zelândia", fifaName: "New Zealand", group: "G", flagCode: "nz" },
  { id: "spain", name: "Espanha", fifaName: "Spain", group: "H", flagCode: "es" },
  { id: "cape-verde", name: "Cabo Verde", fifaName: "Cape Verde", group: "H", flagCode: "cv" },
  { id: "saudi-arabia", name: "Arábia Saudita", fifaName: "Saudi Arabia", group: "H", flagCode: "sa" },
  { id: "uruguay", name: "Uruguai", fifaName: "Uruguay", group: "H", flagCode: "uy" },
  { id: "france", name: "França", fifaName: "France", group: "I", flagCode: "fr" },
  { id: "senegal", name: "Senegal", fifaName: "Senegal", group: "I", flagCode: "sn" },
  { id: "iraq", name: "Iraque", fifaName: "Iraq", group: "I", flagCode: "iq" },
  { id: "norway", name: "Noruega", fifaName: "Norway", group: "I", flagCode: "no" },
  { id: "argentina", name: "Argentina", fifaName: "Argentina", group: "J", flagCode: "ar" },
  { id: "algeria", name: "Argélia", fifaName: "Algeria", group: "J", flagCode: "dz" },
  { id: "austria", name: "Áustria", fifaName: "Austria", group: "J", flagCode: "at" },
  { id: "jordan", name: "Jordânia", fifaName: "Jordan", group: "J", flagCode: "jo" },
  { id: "portugal", name: "Portugal", fifaName: "Portugal", group: "K", flagCode: "pt" },
  { id: "dr-congo", name: "RD Congo", fifaName: "DR Congo", group: "K", flagCode: "cd" },
  { id: "uzbekistan", name: "Uzbequistão", fifaName: "Uzbekistan", group: "K", flagCode: "uz" },
  { id: "colombia", name: "Colômbia", fifaName: "Colombia", group: "K", flagCode: "co" },
  { id: "england", name: "Inglaterra", fifaName: "England", group: "L", flagCode: "gb-eng" },
  { id: "croatia", name: "Croácia", fifaName: "Croatia", group: "L", flagCode: "hr" },
  { id: "ghana", name: "Gana", fifaName: "Ghana", group: "L", flagCode: "gh" },
  { id: "panama", name: "Panamá", fifaName: "Panama", group: "L", flagCode: "pa" }
];

export const teamsById = Object.fromEntries(worldCupTeams.map((team) => [team.id, team]));

export function getFlagUrl(team) {
  return `https://flagcdn.com/${team.flagCode}.svg`;
}

export function getTeamsByGroup() {
  return worldCupTeams.reduce((groups, team) => {
    groups[team.group] = groups[team.group] ?? [];
    groups[team.group].push(team);
    return groups;
  }, {});
}
