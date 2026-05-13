import { initSidebar } from "./sidebar.js";
import { t } from "./i18n.js";
import { loadTeamContext } from "./team-context.js";
import { db } from "./firebase-config.js";
import {
  doc,
  getDoc,
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

initSidebar("home");

const els = {
  noTeam: document.getElementById("no-team"),
  main: document.getElementById("main"),
  welcomeGreeting: document.getElementById("welcome-greeting"),
  dash: document.getElementById("team-dash"),

  // Card 1 : Profile
  profileScore: document.getElementById("profile-score"),
  profileScoreTrend: document.getElementById("profile-score-trend"),
  profileRank: document.getElementById("profile-rank"),
  profileWinrate: document.getElementById("profile-winrate"),
  profileRadar: document.getElementById("profile-radar"),

  // Card 2 : Quick stats
  quickMatches: document.getElementById("quickstats-matches"),
  quickCoop: document.getElementById("quickstats-coop"),
  quickAvgScore: document.getElementById("quickstats-avg-score"),
  quickChart: document.getElementById("quickstats-chart"),

  // Card 3 : Last tournament
  lasttournamentEmpty: document.getElementById("lasttournament-empty"),
  lasttournamentContent: document.getElementById("lasttournament-content"),
  lasttournamentName: document.getElementById("lasttournament-name"),
  lasttournamentTime: document.getElementById("lasttournament-time"),
  lasttournamentRank: document.getElementById("lasttournament-rank"),
  lasttournamentRankOf: document.getElementById("lasttournament-rank-of"),
  lasttournamentScore: document.getElementById("lasttournament-score"),
  lasttournamentMatches: document.getElementById("lasttournament-matches"),
  lasttournamentLink: document.getElementById("lasttournament-link")
};

let context = null;
let radarChart = null;
let evoChart = null;

loadTeamContext({
  onLoaded: async (ctx) => {
    context = ctx;
    renderGreeting();
    els.main.hidden = false;
    await loadAndRender();
  },
  onNoTeam: () => { els.noTeam.hidden = false; }
});

function renderGreeting() {
  els.welcomeGreeting.textContent = t("welcome.greeting", { name: context.team.display_name });
}

async function loadAndRender() {
  // Load everything we need : all teams (for rank), all matches across all
  // tournaments (for the per-team aggregates).
  const [teamsSnap, tournamentsSnap] = await Promise.all([
    getDocs(collection(db, "teams")),
    getDocs(collection(db, "tournaments"))
  ]);
  const allTeams = [];
  teamsSnap.forEach((d) => allTeams.push({ id: d.id, ...d.data() }));
  const tournaments = [];
  tournamentsSnap.forEach((d) => tournaments.push({ id: d.id, ...d.data() }));

  const matchesByTournament = await Promise.all(tournaments.map(async (tt) => {
    try {
      const snap = await getDocs(collection(db, "tournaments", tt.id, "matches"));
      const arr = [];
      snap.forEach((d) => arr.push({ id: d.id, tournament_id: tt.id, tournament_name: tt.name, ...d.data() }));
      return arr;
    } catch { return []; }
  }));
  const allMatches = matchesByTournament.flat();
  allMatches.sort((a, b) => (a.played_at?.toMillis?.() ?? 0) - (b.played_at?.toMillis?.() ?? 0));

  // Per-team aggregates (points + W/L/T) across all matches.
  const pointsByTeam = {}, recordByTeam = {};
  for (const tm of allTeams) {
    pointsByTeam[tm.id] = 0;
    recordByTeam[tm.id] = { wins: 0, losses: 0, ties: 0 };
  }
  for (const m of allMatches) {
    const a = m.team_a_id, b = m.team_b_id;
    if (!(a in pointsByTeam) || !(b in pointsByTeam)) continue;
    const sa = m.score_a ?? 0, sb = m.score_b ?? 0;
    pointsByTeam[a] += sa;
    pointsByTeam[b] += sb;
    if (sa > sb) { recordByTeam[a].wins++; recordByTeam[b].losses++; }
    else if (sa < sb) { recordByTeam[a].losses++; recordByTeam[b].wins++; }
    else { recordByTeam[a].ties++; recordByTeam[b].ties++; }
  }

  const myId = context.uid;
  // No matches at all → hide the whole dashboard, just show the greeting + hero.
  if (allMatches.length === 0) {
    els.dash.hidden = true;
    return;
  }
  els.dash.hidden = false;

  // --- Card 1 : Profile ---
  renderProfileCard(allTeams, pointsByTeam, recordByTeam, allMatches);

  // --- Card 2 : Quick stats ---
  renderQuickStats(allMatches, tournaments, pointsByTeam, allTeams);

  // --- Card 3 : Last tournament ---
  renderLastTournament(allMatches, tournaments, allTeams);
}

// ---------- Card 4 : Last tournament ----------
function renderLastTournament(allMatches, tournaments, allTeams) {
  const myId = context.uid;
  // Group matches per tournament
  const matchesByTid = {};
  for (const m of allMatches) {
    (matchesByTid[m.tournament_id] = matchesByTid[m.tournament_id] || []).push(m);
  }
  // Pick completed tournaments where the team played, most recent first.
  const candidates = tournaments
    .filter((tt) => tt.status === "completed" && (matchesByTid[tt.id] || []).some((m) => m.team_a_id === myId || m.team_b_id === myId))
    .sort((a, b) => (b.completed_at?.toMillis?.() ?? 0) - (a.completed_at?.toMillis?.() ?? 0));
  if (candidates.length === 0) {
    els.lasttournamentEmpty.hidden = false;
    els.lasttournamentContent.hidden = true;
    return;
  }
  const tt = candidates[0];
  const tournamentMatches = matchesByTid[tt.id] || [];

  // Compute my rank in this tournament : sum points per team, sort by points
  // desc with deterministic tie-break by display_name asc.
  const pts = {};
  for (const m of tournamentMatches) {
    pts[m.team_a_id] = (pts[m.team_a_id] || 0) + (m.score_a || 0);
    pts[m.team_b_id] = (pts[m.team_b_id] || 0) + (m.score_b || 0);
  }
  const nameOf = (id) => allTeams.find((tm) => tm.id === id)?.display_name || id;
  const ranked = Object.entries(pts).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return nameOf(a[0]).localeCompare(nameOf(b[0]));
  });
  const myRank = ranked.findIndex(([id]) => id === myId);
  const myPts = pts[myId] || 0;
  const myMatches = tournamentMatches.filter((m) => m.team_a_id === myId || m.team_b_id === myId);

  els.lasttournamentName.textContent = (tt.emoji ? tt.emoji + " " : "") + tt.name;
  els.lasttournamentTime.textContent = tt.completed_at?.toDate ? relativeTime(tt.completed_at.toDate()) : "—";
  els.lasttournamentRank.textContent = myRank >= 0 ? `#${myRank + 1}` : "—";
  els.lasttournamentRankOf.textContent = `/ ${ranked.length}`;
  els.lasttournamentScore.textContent = myPts;
  els.lasttournamentMatches.textContent = myMatches.length;
  els.lasttournamentLink.href = `tournament-view.html?t=${encodeURIComponent(tt.id)}`;

  els.lasttournamentEmpty.hidden = true;
  els.lasttournamentContent.hidden = false;
}

// ---------- Card 1 : Profile ----------
function renderProfileCard(allTeams, pointsByTeam, recordByTeam, allMatches) {
  const myId = context.uid;
  const myPoints = pointsByTeam[myId] || 0;
  const r = recordByTeam[myId] || { wins: 0, losses: 0, ties: 0 };
  const totalGames = r.wins + r.losses + r.ties;
  const wr = totalGames > 0 ? (r.wins / totalGames) : null;

  // Rank : sort all teams who actually played, find my position.
  const ranked = allTeams
    .filter((tm) => {
      const rr = recordByTeam[tm.id];
      return rr && (rr.wins + rr.losses + rr.ties) > 0;
    })
    .sort((a, b) => {
      const pa = pointsByTeam[a.id] || 0;
      const pb = pointsByTeam[b.id] || 0;
      if (pb !== pa) return pb - pa;
      return (a.display_name || "").localeCompare(b.display_name || "");
    });
  const myRank = ranked.findIndex((tm) => tm.id === myId);
  const rankLabel = myRank >= 0 ? `#${myRank + 1}` : "—";
  const rankOf = ranked.length;

  els.profileScore.textContent = myPoints || "—";
  els.profileRank.innerHTML = `${rankLabel} <span class="muted small">/ ${rankOf || allTeams.length}</span>`;
  els.profileWinrate.textContent = wr == null ? "—" : `${Math.round(wr * 100)}%`;

  // Trend arrow : compare last half of matches to first half on avg score.
  const myMatches = allMatches.filter((m) => m.team_a_id === myId || m.team_b_id === myId);
  if (myMatches.length >= 4) {
    const half = Math.floor(myMatches.length / 2);
    const firstAvg = avgMyScore(myMatches.slice(0, half), myId);
    const lastAvg = avgMyScore(myMatches.slice(half), myId);
    els.profileScoreTrend.textContent = lastAvg > firstAvg ? "↑" : lastAvg < firstAvg ? "↓" : "→";
    els.profileScoreTrend.className = "profile-stat-trend " + (lastAvg > firstAvg ? "up" : lastAvg < firstAvg ? "down" : "flat");
  } else {
    els.profileScoreTrend.textContent = "";
  }

  // Radar : compute behavioral profile from my move histories.
  const seqs = collectMySequences(myMatches, myId);
  const stats = aggregateBehaviorStats(seqs);
  if (stats) renderRadar(stats);
}

function avgMyScore(matches, myId) {
  if (matches.length === 0) return 0;
  let total = 0;
  for (const m of matches) {
    total += (m.team_a_id === myId ? m.score_a : m.score_b) || 0;
  }
  return total / matches.length;
}

function collectMySequences(matches, myId) {
  const out = [];
  for (const m of matches) {
    if (m.team_a_id === myId && m.history_a) out.push({ my: m.history_a, opp: m.history_b || "" });
    else if (m.team_b_id === myId && m.history_b) out.push({ my: m.history_b, opp: m.history_a || "" });
  }
  return out;
}

// Ported from sandbox.py:analyze_strategy, aggregated across all matches.
function aggregateBehaviorStats(seqs) {
  let coop = 0, react = 0, forg = 0, retal = 0, run = 0, count = 0;
  for (const s of seqs) {
    const m = s.my, o = s.opp;
    const n = Math.min(m.length, o.length);
    if (n < 2) continue;
    let coopHits = 0, reactHits = 0, forgChances = 0, forgHits = 0, retalHits = 0, runs = 1;
    for (let i = 0; i < n; i++) if (m[i] === "C") coopHits++;
    for (let i = 1; i < n; i++) {
      if (m[i] === o[i - 1]) reactHits++;
      if (o[i - 1] === "D") {
        forgChances++;
        if (m[i] === "C") forgHits++;
        else if (m[i] === "D") retalHits++;
      }
      if (m[i] !== m[i - 1]) runs++;
    }
    coop += coopHits / n;
    react += reactHits / Math.max(1, n - 1);
    forg += forgChances > 0 ? forgHits / forgChances : 0;
    retal += forgChances > 0 ? retalHits / forgChances : 0;
    run += n / runs;
    count++;
  }
  if (count === 0) return null;
  return {
    coop_rate: coop / count,
    reactivity: react / count,
    forgiveness: forg / count,
    retaliation: retal / count,
    avg_run: run / count
  };
}

async function renderRadar(s) {
  if (!window.Chart) {
    try {
      const mod = await import("https://cdn.jsdelivr.net/npm/chart.js@4.4.4/auto/+esm");
      window.Chart = mod.default || mod.Chart;
    } catch { return; }
  }
  const stability = clamp01(1 - 1 / Math.max(1, s.avg_run));
  const exploitability = Math.min(1, s.forgiveness * (1 - s.coop_rate) + 0.2 * (1 - stability));
  const values = [s.coop_rate, 1 - s.coop_rate, s.forgiveness, stability, exploitability]
    .map((x) => Math.round((x || 0) * 100));
  const labels = [
    t("strategies.profile.cooperation"),
    t("strategies.profile.aggression"),
    t("strategies.profile.forgiveness"),
    t("strategies.profile.stability"),
    t("strategies.profile.exploitability")
  ];
  if (radarChart) { radarChart.destroy(); radarChart = null; }
  radarChart = new window.Chart(els.profileRadar, {
    type: "radar",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: "rgba(95,227,216,0.18)",
        borderColor: "#5fe3d8",
        borderWidth: 2,
        pointBackgroundColor: "#5fe3d8",
        pointRadius: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { r: {
        suggestedMin: 0, suggestedMax: 100,
        ticks: { display: false, stepSize: 25 },
        grid: { color: "rgba(95,227,216,0.15)" },
        angleLines: { color: "rgba(95,227,216,0.2)" },
        pointLabels: { color: "#c5d4d9", font: { family: "JetBrains Mono", size: 10, weight: "600" } }
      } }
    }
  });
}

function clamp01(x) { return Math.max(0, Math.min(1, x)); }

// ---------- Card 2 : Quick stats ----------
function renderQuickStats(allMatches, tournaments, pointsByTeam, allTeams) {
  const myId = context.uid;
  const myMatches = allMatches.filter((m) => m.team_a_id === myId || m.team_b_id === myId);
  const myScoreSum = myMatches.reduce((acc, m) => acc + ((m.team_a_id === myId ? m.score_a : m.score_b) || 0), 0);
  let myCoopRate = 0;
  let myCoopCount = 0;
  for (const m of myMatches) {
    const h = m.team_a_id === myId ? m.history_a : m.history_b;
    if (!h) continue;
    const c = (h.match(/C/g) || []).length;
    myCoopRate += c / h.length;
    myCoopCount++;
  }
  const avgCoop = myCoopCount > 0 ? myCoopRate / myCoopCount : 0;
  const avgScore = myMatches.length > 0 ? myScoreSum / myMatches.length : 0;

  els.quickMatches.textContent = myMatches.length;
  els.quickCoop.textContent = `${Math.round(avgCoop * 100)}%`;
  els.quickAvgScore.textContent = avgScore.toFixed(2);

  // Evolution chart : per completed tournament, plot my avg score vs the
  // global avg score per team-match in that tournament.
  renderEvoChart(allMatches, tournaments);
}

async function renderEvoChart(allMatches, tournaments) {
  if (!window.Chart) {
    try {
      const mod = await import("https://cdn.jsdelivr.net/npm/chart.js@4.4.4/auto/+esm");
      window.Chart = mod.default || mod.Chart;
    } catch { return; }
  }
  // Group matches by tournament_id, in order of tournament created_at.
  const matchesByTid = {};
  for (const m of allMatches) {
    (matchesByTid[m.tournament_id] = matchesByTid[m.tournament_id] || []).push(m);
  }
  const ordered = tournaments
    .filter((tt) => tt.status === "completed" && matchesByTid[tt.id])
    .sort((a, b) => (a.completed_at?.toMillis?.() ?? 0) - (b.completed_at?.toMillis?.() ?? 0));

  const myId = context.uid;
  const labels = [];
  const youData = [];
  const metaData = [];
  for (const tt of ordered) {
    const ms = matchesByTid[tt.id];
    // My avg score in this tournament
    const mine = ms.filter((m) => m.team_a_id === myId || m.team_b_id === myId);
    if (mine.length === 0) continue;
    const myAvg = mine.reduce((a, m) => a + ((m.team_a_id === myId ? m.score_a : m.score_b) || 0), 0) / mine.length;
    // Meta : total points distributed / (2 × nb matches) — avg score per team-match
    const totalPts = ms.reduce((a, m) => a + (m.score_a || 0) + (m.score_b || 0), 0);
    const metaAvg = ms.length > 0 ? totalPts / (2 * ms.length) : 0;
    labels.push(tt.name);
    youData.push(myAvg);
    metaData.push(metaAvg);
  }

  if (labels.length === 0) {
    // No completed tournament data yet → leave chart blank.
    return;
  }

  if (evoChart) { evoChart.destroy(); evoChart = null; }
  evoChart = new window.Chart(els.quickChart, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: t("team.dash.quickstats.you"), data: youData, borderColor: "#5fe3d8", backgroundColor: "rgba(95,227,216,0.12)", tension: 0.3, pointRadius: 3 },
        { label: t("team.dash.quickstats.meta"), data: metaData, borderColor: "#ff8a8a", backgroundColor: "rgba(255,138,138,0.12)", tension: 0.3, pointRadius: 3 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#7a8990", font: { size: 9 } }, grid: { color: "rgba(255,255,255,0.04)" } },
        y: { ticks: { color: "#7a8990", font: { size: 9 } }, grid: { color: "rgba(255,255,255,0.04)" }, beginAtZero: true }
      }
    }
  });
}

function relativeTime(date) {
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return t("time.just_now");
  if (minutes < 60) return t("time.minutes_ago", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("time.hours_ago", { n: hours });
  const days = Math.floor(hours / 24);
  return t("time.days_ago", { n: days });
}

document.addEventListener("langchange", () => {
  if (context) {
    renderGreeting();
    loadAndRender();
  }
});
