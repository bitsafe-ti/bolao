import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  APP_VERSION,
  STORAGE_KEY,
  calculateRanking,
  createInitialState,
  emptyPrediction,
  isSuperAdminEmail,
  makeId,
  normalizeEmailList,
  normalizeUsers
} from "./domain.js";
import { getFlagUrl, teamsById, worldCupTeams } from "./teams.js";
import { applyResultUpdates, fetchWorldCupResults } from "./resultsSync.js";
import "./styles.css";

const WORLD_CUP_LOGO_URL =
  "https://upload.wikimedia.org/wikipedia/commons/a/ab/2026_FIFA_World_Cup_emblem_%28horizontal_lockup%29.svg";
const SUPER_ADMIN_EMAILS = normalizeEmailList(
  `${import.meta.env.VITE_SUPER_ADMIN_EMAILS ?? ""},${import.meta.env.VITE_SUPER_ADMIN_EMAIL ?? ""}`
);

const userTabs = [
  { id: "predictions", label: "Palpites" },
  { id: "dailyPredictions", label: "Palpites do Dia" },
  { id: "results", label: "Resultados" },
  { id: "ranking", label: "Ranking" }
];

const adminTabs = [
  { id: "participants", label: "Participantes" },
  { id: "matches", label: "Jogos" },
  ...userTabs
];

const defaultRounds = [1, 2, 3];

function getMatchRound(match) {
  if (match.round) return Number(match.round);
  const matchRound = match.phase?.match(/Rodada\s+(\d+)/i);
  return matchRound ? Number(matchRound[1]) : null;
}

function getMatchDateKey(match) {
  return match.date?.slice(0, 10) || "";
}

function getTodayKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const getPart = (type) => parts.find((part) => part.type === type)?.value;
  return `${getPart("year")}-${getPart("month")}-${getPart("day")}`;
}

function mergeMatchesWithSchedule(savedMatches, scheduledMatches) {
  const scheduleById = Object.fromEntries(scheduledMatches.map((match) => [match.id, match]));
  const savedIds = new Set(savedMatches.map((match) => match.id));
  const mergedMatches = savedMatches.map((match) => {
    const scheduled = scheduleById[match.id];
    if (!scheduled) return match;
    return {
      ...match,
      homeTeamId: scheduled.homeTeamId,
      awayTeamId: scheduled.awayTeamId,
      date: scheduled.date,
      round: scheduled.round,
      phase: scheduled.phase,
      ground: scheduled.ground,
      city: scheduled.city,
      stadium: scheduled.stadium,
      country: scheduled.country
    };
  });

  return [
    ...mergedMatches,
    ...scheduledMatches.filter((match) => !savedIds.has(match.id))
  ];
}

function loadState() {
  const initialState = createInitialState();
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return initialState;
    const parsed = JSON.parse(saved);
    const isLegacyState = !parsed.version;
    const hasTeamMatches = parsed.matches?.some((match) => match.homeTeamId && match.awayTeamId);
    const matches = hasTeamMatches
      ? mergeMatchesWithSchedule(parsed.matches, initialState.matches)
      : initialState.matches;
    const users = normalizeUsers(parsed.users ?? [], SUPER_ADMIN_EMAILS);
    return {
      ...initialState,
      ...parsed,
      version: APP_VERSION,
      users,
      participants: isLegacyState && !parsed.users ? [] : parsed.participants ?? [],
      matches,
      predictions: hasTeamMatches && !isLegacyState ? parsed.predictions ?? {} : {},
      activeParticipantId: isLegacyState ? "" : parsed.activeParticipantId ?? "",
      currentUserId: isLegacyState ? "" : parsed.currentUserId ?? ""
    };
  } catch {
    return initialState;
  }
}

function App() {
  const [state, setState] = useState(loadState);
  const [tab, setTab] = useState("predictions");
  const [authError, setAuthError] = useState("");
  const [syncStatus, setSyncStatus] = useState({ state: "idle", message: "Resultados automáticos ativos." });
  const [selectedPredictionDate, setSelectedPredictionDate] = useState("");
  const [selectedOverviewDate, setSelectedOverviewDate] = useState("");
  const [selectedResultDate, setSelectedResultDate] = useState("");

  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  const isAdmin = currentUser?.role === "admin";
  const visibleTabs = isAdmin ? adminTabs : userTabs;
  const ranking = useMemo(
    () => calculateRanking(state.participants, state.matches, state.predictions),
    [state.matches, state.participants, state.predictions]
  );
  const predictionDates = useMemo(() => {
    return [...new Set(state.matches.map(getMatchDateKey).filter(Boolean))].sort();
  }, [state.matches]);
  const activePredictionDate = useMemo(() => {
    if (predictionDates.includes(selectedPredictionDate)) return selectedPredictionDate;
    const today = getTodayKey();
    if (predictionDates.includes(today)) return today;
    return predictionDates.find((date) => date >= today) ?? predictionDates[0] ?? "";
  }, [predictionDates, selectedPredictionDate]);
  const activeOverviewDate = useMemo(() => {
    if (predictionDates.includes(selectedOverviewDate)) return selectedOverviewDate;
    const today = getTodayKey();
    if (predictionDates.includes(today)) return today;
    return predictionDates.find((date) => date >= today) ?? predictionDates[0] ?? "";
  }, [predictionDates, selectedOverviewDate]);
  const activeResultDate = useMemo(() => {
    if (predictionDates.includes(selectedResultDate)) return selectedResultDate;
    const today = getTodayKey();
    if (predictionDates.includes(today)) return today;
    return predictionDates.find((date) => date >= today) ?? predictionDates[0] ?? "";
  }, [predictionDates, selectedResultDate]);
  const predictionMatches = state.matches
    .filter((match) => getMatchDateKey(match) === activePredictionDate)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const overviewMatches = state.matches
    .filter((match) => getMatchDateKey(match) === activeOverviewDate)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const resultMatches = state.matches
    .filter((match) => getMatchDateKey(match) === activeResultDate)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  function updateState(recipe) {
    setState((current) => {
      const next = typeof recipe === "function" ? recipe(current) : recipe;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function syncResults(mode = "manual") {
    setSyncStatus({ state: "loading", message: "Atualizando resultados..." });
    try {
      const sourceMatches = await fetchWorldCupResults();
      let changed = 0;
      updateState((current) => {
        const update = applyResultUpdates(current.matches, sourceMatches);
        changed = update.changed;
        return {
          ...current,
          matches: update.matches,
          lastResultSyncAt: new Date().toISOString()
        };
      });
      setSyncStatus({
        state: "success",
        message:
          changed > 0
            ? `${changed} jogos sincronizados.`
            : `Sem novos resultados. Última verificação ${formatShortTime(new Date())}.`
      });
    } catch (error) {
      setSyncStatus({
        state: "error",
        message: `Não consegui atualizar agora. ${error.message}`
      });
    }
  }

  useEffect(() => {
    if (!currentUser) return undefined;
    syncResults("auto");
    const intervalId = window.setInterval(() => syncResults("auto"), 5 * 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, [currentUser?.id]);

  useEffect(() => {
    if (!visibleTabs.some((item) => item.id === tab)) {
      setTab("predictions");
    }
  }, [tab, visibleTabs]);

  function registerUser({ name, email, password, favoriteTeamId }) {
    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanName || !cleanEmail || !password) {
      setAuthError("Preencha nome, e-mail e senha para criar sua conta.");
      return;
    }
    if (state.users.some((user) => user.email === cleanEmail)) {
      setAuthError("Este e-mail já está cadastrado. Entre com sua senha.");
      return;
    }

    const participant = { id: makeId("participant"), name: cleanName };
    const user = {
      id: makeId("user"),
      name: cleanName,
      email: cleanEmail,
      password,
      role: isSuperAdminEmail(cleanEmail, SUPER_ADMIN_EMAILS) ? "admin" : "user",
      favoriteTeamId,
      participantId: participant.id
    };

    updateState((current) => ({
      ...current,
      users: [...current.users, user],
      participants: [...current.participants, participant],
      currentUserId: user.id,
      activeParticipantId: participant.id
    }));
    setAuthError("");
  }

  function loginUser({ email, password }) {
    const cleanEmail = email.trim().toLowerCase();
    const user = state.users.find((item) => item.email === cleanEmail && item.password === password);
    if (!user) {
      setAuthError("E-mail ou senha inválidos.");
      return;
    }
    updateState((current) => ({
      ...current,
      currentUserId: user.id,
      activeParticipantId: user.participantId || current.activeParticipantId
    }));
    setAuthError("");
  }

  function logoutUser() {
    updateState((current) => ({ ...current, currentUserId: "" }));
  }

  function addParticipant(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = form.get("name").trim();
    if (!name) return;
    updateState((current) => {
      const participant = { id: makeId("participant"), name };
      return {
        ...current,
        participants: [...current.participants, participant],
        activeParticipantId: current.activeParticipantId || participant.id
      };
    });
    event.currentTarget.reset();
  }

  function removeParticipant(participantId) {
    updateState((current) => {
      const predictions = { ...current.predictions };
      delete predictions[participantId];
      const participants = current.participants.filter((participant) => participant.id !== participantId);
      const users = current.users.map((user) =>
        user.participantId === participantId ? { ...user, participantId: "" } : user
      );
      return {
        ...current,
        users,
        participants,
        predictions,
        activeParticipantId:
          current.activeParticipantId === participantId ? participants[0]?.id ?? "" : current.activeParticipantId
      };
    });
  }

  function addMatch(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const match = {
      id: makeId("match"),
      phase: form.get("phase").trim() || "Fase de grupos",
      round: Number(form.get("round")) || 1,
      date: form.get("date"),
      homeTeamId: form.get("homeTeamId"),
      awayTeamId: form.get("awayTeamId"),
      homeScore: "",
      awayScore: "",
      homeGoals: [],
      awayGoals: []
    };
    if (!match.homeTeamId || !match.awayTeamId || match.homeTeamId === match.awayTeamId) return;
    updateState((current) => ({ ...current, matches: [...current.matches, match] }));
    event.currentTarget.reset();
  }

  function updateMatch(matchId, field, value) {
    updateState((current) => ({
      ...current,
      matches: current.matches.map((match) => (match.id === matchId ? { ...match, [field]: value } : match))
    }));
  }

  function removeMatch(matchId) {
    updateState((current) => {
      const predictions = Object.fromEntries(
        Object.entries(current.predictions).map(([participantId, participantPredictions]) => {
          const nextPredictions = { ...participantPredictions };
          delete nextPredictions[matchId];
          return [participantId, nextPredictions];
        })
      );
      return {
        ...current,
        matches: current.matches.filter((match) => match.id !== matchId),
        predictions
      };
    });
  }

  function updatePrediction(participantId, matchId, field, value) {
    updateState((current) => ({
      ...current,
      predictions: {
        ...current.predictions,
        [participantId]: {
          ...current.predictions[participantId],
          [matchId]: {
            ...emptyPrediction,
            ...current.predictions[participantId]?.[matchId],
            [field]: value
          }
        }
      }
    }));
  }

  function resetData() {
    if (!confirm("Apagar todos os dados do bolão neste navegador?")) return;
    updateState(createInitialState());
  }

  if (!currentUser) {
    return <AuthScreen error={authError} onLogin={loginUser} onRegister={registerUser} />;
  }

  const userParticipant = state.participants.find((participant) => participant.id === currentUser.participantId);
  const activeParticipant = isAdmin
    ? state.participants.find((participant) => participant.id === state.activeParticipantId) ??
      userParticipant ??
      state.participants[0]
    : userParticipant;
  const currentFavoriteTeam = teamsById[currentUser.favoriteTeamId];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <img src={WORLD_CUP_LOGO_URL} alt="Logo da Copa do Mundo 2026" />
        </div>
        <nav className="tabs" aria-label="Seções do bolão">
          {visibleTabs.map((item) => (
            <button type="button" className={tab === item.id ? "active" : ""} key={item.id} onClick={() => setTab(item.id)}>
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Copa do Mundo 2026</p>
            <h1>{visibleTabs.find((item) => item.id === tab)?.label ?? "Bolão"}</h1>
          </div>
          <div className="topbar-actions">
            <div className="user-chip">
            {currentFavoriteTeam && <Flag team={currentFavoriteTeam} />}
            <span>{currentUser.name}</span>
            {isAdmin && <small>Admin</small>}
            </div>
            {isAdmin && <button type="button" className="secondary" onClick={() => syncResults("manual")}>Atualizar resultados</button>}
            <button type="button" className="ghost" onClick={logoutUser}>Sair</button>
            {isAdmin && <button type="button" className="ghost" onClick={resetData}>Reiniciar</button>}
          </div>
        </header>

      {tab === "participants" && isAdmin && (
        <section className="panel">
          <SectionHeader title="Participantes" caption="Área administrativa. Usuários comuns devem se auto cadastrar e sempre entram com perfil user." />
          <form className="inline-form" onSubmit={addParticipant}>
            <input name="name" placeholder="Nome do participante" />
            <button type="submit">Adicionar</button>
          </form>
          <div className="list">
            {state.participants.map((participant) => (
              <div className="list-row" key={participant.id}>
                <input value={participant.name} onChange={(event) =>
                  updateState((current) => ({
                    ...current,
                    participants: current.participants.map((item) =>
                      item.id === participant.id ? { ...item, name: event.target.value } : item
                    ),
                    users: current.users.map((user) =>
                      user.participantId === participant.id ? { ...user, name: event.target.value } : user
                    )
                  }))
                } />
                <button type="button" className="danger" onClick={() => removeParticipant(participant.id)}>Remover</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === "matches" && isAdmin && (
        <section className="panel">
          <SectionHeader title="Jogos e resultados" caption="A fase de grupos já nasce com as 48 seleções de 2026." />
          <form className="match-form" onSubmit={addMatch}>
            <input name="phase" placeholder="Fase" />
            <RoundSelect name="round" label="Rodada" defaultValue="1" />
            <input name="date" type="datetime-local" />
            <TeamSelect name="homeTeamId" label="Seleção 1" />
            <TeamSelect name="awayTeamId" label="Seleção 2" />
            <button type="submit">Adicionar jogo</button>
          </form>
          <div className="match-list">
            {state.matches.map((match) => (
              <article className="match-card" key={match.id}>
                <div className="match-meta">
                  <input value={match.phase} onChange={(event) => updateMatch(match.id, "phase", event.target.value)} />
                  <RoundSelect value={String(getMatchRound(match) ?? "")} onChange={(event) => updateMatch(match.id, "round", Number(event.target.value))} label="Rodada" />
                  <input type="datetime-local" value={match.date} onChange={(event) => updateMatch(match.id, "date", event.target.value)} />
                </div>
                <div className="score-line">
                  <TeamSelect value={match.homeTeamId ?? ""} onChange={(event) => updateMatch(match.id, "homeTeamId", event.target.value)} label="Mandante" />
                  <ScoreInput value={match.homeScore} onChange={(value) => updateMatch(match.id, "homeScore", value)} />
                  <span>x</span>
                  <ScoreInput value={match.awayScore} onChange={(value) => updateMatch(match.id, "awayScore", value)} />
                  <TeamSelect value={match.awayTeamId ?? ""} onChange={(event) => updateMatch(match.id, "awayTeamId", event.target.value)} label="Visitante" />
                </div>
                <button type="button" className="danger subtle" onClick={() => removeMatch(match.id)}>Remover jogo</button>
              </article>
            ))}
          </div>
        </section>
      )}

      {tab === "predictions" && (
        <section className="panel">
          <SectionHeader title="Palpites" caption="Escolha o dia para ver somente os jogos daquela data." />
          <div className="prediction-toolbar single">
            <label className="select-label">
              Dia dos jogos
              <select value={activePredictionDate} onChange={(event) => setSelectedPredictionDate(event.target.value)}>
                {predictionDates.map((date) => (
                  <option value={date} key={date}>{formatMatchDayOption(date)}</option>
                ))}
              </select>
            </label>
          </div>
          {activeParticipant ? (
            <div className="match-list">
              {predictionMatches.map((match) => {
                const prediction = state.predictions[activeParticipant.id]?.[match.id] ?? emptyPrediction;
                return (
                  <article className="match-card prediction-card" key={match.id}>
                    <div>
                      <span className="badge">{match.phase}</span>
                      <h3 className="teams-versus"><TeamName teamId={match.homeTeamId} fallback={match.home} /> <span>x</span> <TeamName teamId={match.awayTeamId} fallback={match.away} /></h3>
                      <p>{formatDate(match.date)}</p>
                      <p className="match-location">{formatVenue(match)}</p>
                    </div>
                    <div className="prediction-inputs">
                      <ScoreInput value={prediction.home} onChange={(value) => updatePrediction(activeParticipant.id, match.id, "home", value)} />
                      <span>x</span>
                      <ScoreInput value={prediction.away} onChange={(value) => updatePrediction(activeParticipant.id, match.id, "away", value)} />
                    </div>
                  </article>
                );
              })}
              {!predictionMatches.length && <EmptyState text="Nenhum jogo cadastrado para este dia." />}
            </div>
          ) : (
            <EmptyState text="Seu cadastro entra como participante para registrar palpites." />
          )}
        </section>
      )}

      {tab === "dailyPredictions" && (
        <section className="panel">
          <SectionHeader title="Palpites do Dia" caption="Veja todos os palpites registrados para os jogos da data selecionada." />
          <div className="prediction-toolbar">
            <label className="select-label">
              Dia dos jogos
              <select value={activeOverviewDate} onChange={(event) => setSelectedOverviewDate(event.target.value)}>
                {predictionDates.map((date) => (
                  <option value={date} key={date}>{formatMatchDayOption(date)}</option>
                ))}
              </select>
            </label>
          </div>
          <DailyPredictions
            matches={overviewMatches}
            participants={state.participants}
            predictions={state.predictions}
          />
        </section>
      )}

      {tab === "results" && (
        <section className="panel">
          <SectionHeader title="Resultados dos Jogos" caption="Placar oficial sincronizado automaticamente quando a fonte de resultados publicar a partida." />
          <div className={`sync-strip ${syncStatus.state}`}>
            <strong>{syncStatus.message}</strong>
            <span>{state.lastResultSyncAt ? `Última checagem: ${formatDate(state.lastResultSyncAt)}` : "A atualização roda ao entrar e a cada 5 minutos."}</span>
          </div>
          <div className="prediction-toolbar">
            <label className="select-label">
              Dia dos jogos
              <select value={activeResultDate} onChange={(event) => setSelectedResultDate(event.target.value)}>
                {predictionDates.map((date) => (
                  <option value={date} key={date}>{formatMatchDayOption(date)}</option>
                ))}
              </select>
            </label>
          </div>
          <ResultsList matches={resultMatches} />
        </section>
      )}

      {tab === "ranking" && <RankingTable ranking={ranking} />}
      </section>
    </main>
  );
}

function AuthScreen({ error, onLogin, onRegister }) {
  const [mode, setMode] = useState("register");
  function handleSubmit(event) {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    mode === "register" ? onRegister(payload) : onLogin(payload);
  }
  return (
    <main className="auth-page">
      <section className="auth-visual">
        <img
          src="https://store.fifa.com/cdn/shop/files/image_217bb8c0-803c-4772-9c18-18f1e677f831.jpg?v=1780325535&width=900"
          alt="Pôster oficial da FIFA World Cup 2026"
        />
      </section>
      <section className="auth-card">
        <div className="auth-card-header">
          <span>Copa do Mundo 2026</span>
          <h1>Bolão da Copa</h1>
          <h2>{mode === "register" ? "Criar sua conta" : "Entrar no bolão"}</h2>
          <p>{mode === "register" ? "Seu cadastro já entra como participante." : "Use seu e-mail e senha cadastrados."}</p>
        </div>
        <div className="mode-switch" role="tablist" aria-label="Acesso">
          <button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>Criar conta</button>
          <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Entrar</button>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === "register" && <input name="name" placeholder="Seu nome" autoComplete="name" />}
          <input name="email" type="email" placeholder="E-mail" autoComplete="email" />
          <input name="password" type="password" placeholder="Senha" autoComplete="current-password" />
          {mode === "register" && <TeamSelect name="favoriteTeamId" label="Seleção favorita" defaultValue="brazil" />}
          {error && <p className="form-error">{error}</p>}
          <button type="submit">{mode === "register" ? "Cadastrar e entrar" : "Entrar"}</button>
        </form>
        <p className="auth-note">Cadastro local neste navegador. O backend real pode entrar na próxima etapa.</p>
      </section>
    </main>
  );
}

function TeamSelect({ name, value, defaultValue = "", onChange, label }) {
  const selectProps = value === undefined ? { defaultValue } : { value, onChange };
  return (
    <label className="select-shell">
      <span>{label}</span>
      <select name={name} {...selectProps}>
        <option value="">Selecione</option>
        {worldCupTeams.map((team) => (
          <option value={team.id} key={team.id}>Grupo {team.group} - {team.name}</option>
        ))}
      </select>
    </label>
  );
}

function RoundSelect({ name, value, defaultValue = "", onChange, label }) {
  const selectProps = value === undefined ? { defaultValue } : { value, onChange };
  return (
    <label className="select-shell">
      <span>{label}</span>
      <select name={name} {...selectProps}>
        {defaultRounds.map((round) => (
          <option value={round} key={round}>Rodada {round}</option>
        ))}
      </select>
    </label>
  );
}

function TeamName({ teamId, fallback }) {
  const team = teamsById[teamId];
  if (!team) return <>{fallback ?? "Seleção a definir"}</>;
  return <span className="team-name"><Flag team={team} />{team.name}</span>;
}

function Flag({ team }) {
  return <img className="flag" src={getFlagUrl(team)} alt={`Bandeira: ${team.name}`} loading="lazy" />;
}

function SectionHeader({ title, caption }) {
  return <header className="section-header"><h2>{title}</h2><p>{caption}</p></header>;
}

function ScoreInput({ value, onChange }) {
  return <input className="score-input" min="0" inputMode="numeric" type="number" value={value} onChange={(event) => onChange(event.target.value)} placeholder="0" />;
}

function RankingTable({ ranking, compact = false }) {
  return (
    <section className="panel table-panel">
      <SectionHeader title={compact ? "Top 5" : "Ranking"} caption="Critérios: pontos, placares cravados e nome." />
      {!compact && <ScoringExamples />}
      {ranking.length ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Participante</th><th>Pontos</th><th>Cravados</th><th>Ganhador</th><th>Jogos pontuados</th></tr></thead>
            <tbody>
              {ranking.map((participant, index) => (
                <tr key={participant.id}>
                  <td><span className="rank-position">{index + 1}</span></td>
                  <td className="participant-cell">{participant.name}</td>
                  <td><strong className="points-pill">{participant.total}</strong></td>
                  <td>{participant.exactScores}</td>
                  <td>{participant.winnerHits}</td>
                  <td>{participant.scoredMatches}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <EmptyState text="O ranking aparece quando houver participantes cadastrados." />}
    </section>
  );
}

function ResultsList({ matches }) {
  if (!matches.length) {
    return <EmptyState text="Nenhum jogo cadastrado para este dia." />;
  }

  return (
    <div className="match-list results-list">
      {matches.map((match) => (
        <ResultCard key={match.id} match={match} />
      ))}
    </div>
  );
}

function ResultCard({ match }) {
  const homeScore = match.homeScore === "" || match.homeScore === undefined ? null : Number(match.homeScore);
  const awayScore = match.awayScore === "" || match.awayScore === undefined ? null : Number(match.awayScore);
  const hasResult = Number.isInteger(homeScore) && Number.isInteger(awayScore);
  const homeWon = hasResult && homeScore > awayScore;
  const awayWon = hasResult && awayScore > homeScore;

  return (
    <article className={`match-card result-card ${hasResult ? "finished" : "pending"}`}>
      <div className="result-card-header">
        <div>
          <span className="badge">{match.phase}</span>
          <p>{formatDate(match.date)}</p>
          <p className="match-location">{formatVenue(match)}</p>
        </div>
        <span className={`result-status ${hasResult ? "finished" : "pending"}`}>
          {hasResult ? "Resultado atualizado" : "Aguardando resultado"}
        </span>
      </div>
      <div className="result-board">
        <ResultTeam teamId={match.homeTeamId} fallback={match.home} score={homeScore} isWinner={homeWon} />
        <span className="result-separator">x</span>
        <ResultTeam teamId={match.awayTeamId} fallback={match.away} score={awayScore} isWinner={awayWon} align="right" />
      </div>
      <ResultGoals match={match} hasResult={hasResult} />
    </article>
  );
}

function ResultTeam({ teamId, fallback, score, isWinner, align = "left" }) {
  return (
    <div className={`result-team ${isWinner ? "winner" : ""} ${align === "right" ? "right" : ""}`}>
      <TeamName teamId={teamId} fallback={fallback} />
      <strong className="result-score">{score === null ? "-" : score}</strong>
    </div>
  );
}

function ResultGoals({ match, hasResult }) {
  const homeGoals = match.homeGoals ?? [];
  const awayGoals = match.awayGoals ?? [];
  const hasGoals = homeGoals.length > 0 || awayGoals.length > 0;

  if (!hasResult) {
    return null;
  }

  if (!hasGoals) {
    return <p className="result-goals-empty">Nenhum gol registrado para esta partida.</p>;
  }

  return (
    <div className="result-goals">
      <GoalList title="Gols mandante" teamId={match.homeTeamId} fallback={match.home} goals={homeGoals} />
      <GoalList title="Gols visitante" teamId={match.awayTeamId} fallback={match.away} goals={awayGoals} align="right" />
    </div>
  );
}

function GoalList({ teamId, fallback, goals, align = "left" }) {
  return (
    <div className={`goal-list ${align === "right" ? "right" : ""}`}>
      <div className="goal-list-title">
        <TeamName teamId={teamId} fallback={fallback} />
      </div>
      {goals.length ? (
        <ul>
          {goals.map((goal, index) => (
            <li key={`${goal.name}-${goal.minute}-${index}`}>
              <span className="goal-minute">{formatGoalMinute(goal)}</span>
              <strong>{goal.name}</strong>
              {goal.penalty && <span className="goal-tag">Pênalti</span>}
              {goal.ownGoal && <span className="goal-tag">Contra</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p>Sem gols.</p>
      )}
    </div>
  );
}

function DailyPredictions({ matches, participants, predictions }) {
  if (!matches.length) {
    return <EmptyState text="Nenhum jogo cadastrado para este dia." />;
  }

  if (!participants.length) {
    return <EmptyState text="Nenhum participante cadastrado ainda." />;
  }

  return (
    <div className="daily-predictions">
      {matches.map((match) => (
        <DailyPredictionCard
          key={match.id}
          match={match}
          participants={participants}
          predictions={predictions}
        />
      ))}
    </div>
  );
}

function DailyPredictionCard({ match, participants, predictions }) {
  const offeredPredictions = participants
    .map((participant) => ({
      participant,
      prediction: predictions[participant.id]?.[match.id]
    }))
    .filter(({ prediction }) => hasPrediction(prediction));

  return (
    <article className="match-card daily-prediction-card">
      <div>
        <span className="badge">{match.phase}</span>
        <h3 className="teams-versus">
          <TeamName teamId={match.homeTeamId} fallback={match.home} /> <span>x</span>{" "}
          <TeamName teamId={match.awayTeamId} fallback={match.away} />
        </h3>
        <p>{formatDate(match.date)}</p>
        <p className="match-location">{formatVenue(match)}</p>
      </div>
      {offeredPredictions.length ? (
        <div className="table-wrap">
          <table className="compact-table">
            <thead>
              <tr>
                <th>Participante</th>
                <th>Palpite</th>
              </tr>
            </thead>
            <tbody>
              {offeredPredictions.map(({ participant, prediction }) => (
                <tr key={participant.id}>
                  <td>{participant.name}</td>
                  <td><span className="prediction-pill">{formatPrediction(prediction)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">Nenhum palpite registrado para este jogo.</p>
      )}
    </article>
  );
}

function hasPrediction(prediction) {
  return Boolean(prediction && prediction.home !== "" && prediction.away !== "");
}

function formatPrediction(prediction) {
  if (!prediction || prediction.home === "" || prediction.away === "") return "Sem palpite";
  return `${prediction.home} x ${prediction.away}`;
}

function formatGoalMinute(goal) {
  if (goal.minute === "" || goal.minute === null || goal.minute === undefined) return "-";
  return goal.offset ? `${goal.minute}+${goal.offset}'` : `${goal.minute}'`;
}

function ScoringExamples() {
  return (
    <div className="scoring-examples">
      <div>
        <strong>3 pontos</strong>
        <span>Cravou o placar: palpite 2 x 1, resultado 2 x 1.</span>
      </div>
      <div>
        <strong>1 ponto</strong>
        <span>Acertou só o ganhador: palpite 2 x 1, resultado 1 x 0.</span>
      </div>
      <div>
        <strong>0 ponto</strong>
        <span>Errou o ganhador ou o empate sem cravar: palpite 1 x 1, resultado 0 x 0.</span>
      </div>
    </div>
  );
}

function EmptyState({ text }) {
  return <p className="empty">{text}</p>;
}

function formatDate(value) {
  if (!value) return "Data a definir";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function formatMatchDayOption(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  const label = new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit"
  }).format(date);
  return dateKey === getTodayKey() ? `Hoje - ${label}` : label;
}

function formatVenue(match) {
  const city = [match.city, match.country].filter(Boolean).join(", ");
  const stadium = match.stadium || match.ground;
  if (!city && !stadium) return "Local a definir";
  if (!city) return stadium;
  if (!stadium) return city;
  return `${stadium} - ${city}`;
}

function formatShortTime(value) {
  return new Intl.DateTimeFormat("pt-BR", { timeStyle: "short" }).format(value);
}

const rootElement = document.getElementById("root");
const root = globalThis.__bolaoRoot ?? createRoot(rootElement);
globalThis.__bolaoRoot = root;
root.render(<App />);
