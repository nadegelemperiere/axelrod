import { initSidebar } from "./sidebar.js";
import { t } from "./i18n.js";
import { onAuth, isUserAdmin } from "./auth.js";
import { db } from "./firebase-config.js";
import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

initSidebar("tournaments-list");

const els = {
  main: document.getElementById("main"),
  notFound: document.getElementById("not-found"),
  backLink: document.getElementById("back-link"),
  matchMeta: document.getElementById("match-meta"),
  teamAName: document.getElementById("team-a-name"),
  teamBName: document.getElementById("team-b-name"),
  teamASub: document.getElementById("team-a-sub"),
  teamBSub: document.getElementById("team-b-sub"),
  teamAAvatar: document.getElementById("team-a-avatar"),
  teamBAvatar: document.getElementById("team-b-avatar"),
  teamAScore: document.getElementById("team-a-score"),
  teamBScore: document.getElementById("team-b-score"),
  statResult: document.getElementById("stat-result"),
  statDuration: document.getElementById("stat-duration"),
  statCoop: document.getElementById("stat-cooperation"),
  statAdvantage: document.getElementById("stat-max-advantage"),
  statStreak: document.getElementById("stat-longest-streak"),
  donutChart: document.getElementById("donut-chart"),
  donutTotal: document.getElementById("donut-total"),
  donutLegendA: document.getElementById("donut-legend-a"),
  donutLegendB: document.getElementById("donut-legend-b"),
  history: document.getElementById("match-history")
};

const params = new URLSearchParams(window.location.search);
const tournamentId = params.get("t");
const matchId = params.get("m");

if (!tournamentId || !matchId) {
  window.location.href = "tournaments.html";
}

let chart = null;
let matchData = null;
let teamA = null;
let teamB = null;
let viewerUid = null;

onAuth(async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  viewerUid = user.uid;
  // Back link: admins go to tournament.html, teams go to tournament-view.html.
  const admin = await isUserAdmin(user.uid);
  els.backLink.href = admin
    ? `tournament.html?t=${encodeURIComponent(tournamentId)}`
    : `tournament-view.html?t=${encodeURIComponent(tournamentId)}`;

  await load();
});

async function load() {
  const mSnap = await getDoc(doc(db, "tournaments", tournamentId, "matches", matchId));
  if (!mSnap.exists()) {
    els.notFound.hidden = false;
    return;
  }
  matchData = mSnap.data();

  // Fetch both teams' identities for display.
  const [aSnap, bSnap] = await Promise.all([
    getDoc(doc(db, "teams", matchData.team_a_id)),
    getDoc(doc(db, "teams", matchData.team_b_id))
  ]);
  teamA = aSnap.exists() ? aSnap.data() : { display_name: matchData.team_a_id, emoji: "" };
  teamB = bSnap.exists() ? bSnap.data() : { display_name: matchData.team_b_id, emoji: "" };

  // If the viewer is one of the participants, put them on the left (team A slot).
  if (viewerUid === matchData.team_b_id) {
    [matchData.team_a_id, matchData.team_b_id] = [matchData.team_b_id, matchData.team_a_id];
    [matchData.team_a_name, matchData.team_b_name] = [matchData.team_b_name, matchData.team_a_name];
    [matchData.bot_a_name, matchData.bot_b_name] = [matchData.bot_b_name, matchData.bot_a_name];
    [matchData.score_a, matchData.score_b] = [matchData.score_b, matchData.score_a];
    [matchData.history_a, matchData.history_b] = [matchData.history_b, matchData.history_a];
    [teamA, teamB] = [teamB, teamA];
  }

  els.main.hidden = false;
  render();
}

function render() {
  // Header meta: tournament name + date
  fetchTournamentName().then((name) => {
    const date = matchData.played_at?.toDate?.()?.toLocaleDateString(
      document.documentElement.lang === "fr" ? "fr-FR" : "en-GB"
    );
    els.matchMeta.textContent = [name, date].filter(Boolean).join(" · ");
  });

  els.teamAName.textContent = labelFor(teamA, matchData.team_a_name);
  els.teamBName.textContent = labelFor(teamB, matchData.team_b_name);
  els.teamASub.textContent = matchData.bot_a_name || "";
  els.teamBSub.textContent = matchData.bot_b_name || "";
  els.teamAAvatar.src = avatarUrl(matchData.bot_a_name || matchData.team_a_id);
  els.teamBAvatar.src = avatarUrl(matchData.bot_b_name || matchData.team_b_id);
  els.teamAScore.textContent = matchData.score_a ?? 0;
  els.teamBScore.textContent = matchData.score_b ?? 0;

  // Stats
  const sa = matchData.score_a ?? 0;
  const sb = matchData.score_b ?? 0;
  let resultKey, resultClass;
  if (sa > sb) { resultKey = "match.result.win_a"; resultClass = "ok"; }
  else if (sa < sb) { resultKey = "match.result.win_b"; resultClass = "ko"; }
  else { resultKey = "match.result.tie"; resultClass = ""; }
  els.statResult.textContent = t(resultKey);
  els.statResult.className = `match-stat-value ${resultClass}`;

  const nbTurns = matchData.nb_turns || (matchData.history_a || "").length;
  els.statDuration.textContent = t("match.stat.duration.value", { n: nbTurns });

  const coopA = rateOfC(matchData.history_a);
  const coopB = rateOfC(matchData.history_b);
  els.statCoop.innerHTML = `
    <span class="match-stat-coop-a">${pct(coopA)}</span>
    <span class="match-stat-coop-sep">vs</span>
    <span class="match-stat-coop-b">${pct(coopB)}</span>
  `;

  const maxAdv = maxAdvantage(matchData.history_a, matchData.history_b);
  els.statAdvantage.textContent = (maxAdv >= 0 ? "+" : "") + maxAdv;

  const streakC = longestRun(matchData.history_a, "C");
  const streakD = longestRun(matchData.history_a, "D");
  els.statStreak.innerHTML = `
    <span class="match-streak-c">C ${streakC}</span>
    <span class="match-streak-sep">/</span>
    <span class="match-streak-d">D ${streakD}</span>
  `;

  // Donut
  const total = sa + sb;
  els.donutTotal.textContent = total;
  els.donutLegendA.textContent = `${labelFor(teamA, matchData.team_a_name)} ${pct(total ? sa / total : 0)}`;
  els.donutLegendB.textContent = `${labelFor(teamB, matchData.team_b_name)} ${pct(total ? sb / total : 0)}`;
  renderDonut(sa, sb);

  // Move history
  renderHistory();
}

async function fetchTournamentName() {
  try {
    const tSnap = await getDoc(doc(db, "tournaments", tournamentId));
    return tSnap.exists() ? (tSnap.data().name || "") : "";
  } catch {
    return "";
  }
}

function labelFor(teamDoc, fallback) {
  const name = teamDoc?.display_name || fallback || "?";
  return teamDoc?.emoji ? `${teamDoc.emoji} ${name}` : name;
}

function avatarUrl(seed) {
  return `https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${encodeURIComponent(seed || "x")}&backgroundColor=transparent`;
}

function rateOfC(history) {
  if (!history) return 0;
  let c = 0;
  for (const ch of history) if (ch === "C") c++;
  return c / history.length;
}

function pct(x) {
  return `${Math.round(x * 100)}%`;
}

function maxAdvantage(ha, hb) {
  // Maximum cumulative score difference (a - b) at any turn.
  const PAYOFF = {
    "CC": [3, 3], "CD": [0, 5], "DC": [5, 0], "DD": [1, 1]
  };
  let sa = 0, sb = 0;
  let maxDiff = 0;
  const n = Math.min(ha.length, hb.length);
  for (let i = 0; i < n; i++) {
    const [pa, pb] = PAYOFF[ha[i] + hb[i]] || [0, 0];
    sa += pa; sb += pb;
    const d = sa - sb;
    if (Math.abs(d) > Math.abs(maxDiff)) maxDiff = d;
  }
  return maxDiff;
}

function longestRun(history, ch) {
  if (!history) return 0;
  let best = 0, cur = 0;
  for (const c of history) {
    if (c === ch) { cur++; if (cur > best) best = cur; }
    else cur = 0;
  }
  return best;
}

async function renderDonut(sa, sb) {
  if (!window.Chart) {
    try {
      const mod = await import("https://cdn.jsdelivr.net/npm/chart.js@4.4.4/auto/+esm");
      window.Chart = mod.default || mod.Chart;
    } catch (err) {
      console.error("Chart.js failed to load", err);
      return;
    }
  }
  if (chart) { chart.destroy(); chart = null; }
  chart = new window.Chart(els.donutChart, {
    type: "doughnut",
    data: {
      labels: [labelFor(teamA, matchData.team_a_name), labelFor(teamB, matchData.team_b_name)],
      datasets: [{
        data: [sa, sb],
        backgroundColor: ["#5fe3d8", "#ff7676"],
        borderColor: "transparent",
        borderWidth: 0,
        cutout: "68%"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: true } }
    }
  });
}

function renderHistory() {
  const ha = matchData.history_a || "";
  const hb = matchData.history_b || "";
  const n = Math.max(ha.length, hb.length);
  if (n === 0) {
    els.history.innerHTML = `<p class="muted small">${t("match.history.empty")}</p>`;
    return;
  }

  // Header with turn indices every 10 turns
  let headerCells = "";
  for (let i = 0; i < n; i++) {
    const showLabel = i === 0 || (i + 1) % 10 === 0;
    headerCells += `<span class="match-turn-label">${showLabel ? (i + 1) : ""}</span>`;
  }

  let rowA = "", rowB = "";
  for (let i = 0; i < n; i++) {
    const a = ha[i] || "";
    const b = hb[i] || "";
    rowA += `<span class="match-cell match-cell-${a === "C" ? "c" : a === "D" ? "d" : "x"}">${a}</span>`;
    rowB += `<span class="match-cell match-cell-${b === "C" ? "c" : b === "D" ? "d" : "x"}">${b}</span>`;
  }

  els.history.innerHTML = `
    <div class="match-history-row match-history-header">
      <span class="match-history-label">${t("match.history.turn")}</span>
      <div class="match-history-cells">${headerCells}</div>
    </div>
    <div class="match-history-row">
      <span class="match-history-label">${escapeHtml(labelFor(teamA, matchData.team_a_name))}</span>
      <div class="match-history-cells">${rowA}</div>
    </div>
    <div class="match-history-row">
      <span class="match-history-label">${escapeHtml(labelFor(teamB, matchData.team_b_name))}</span>
      <div class="match-history-cells">${rowB}</div>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

document.addEventListener("langchange", () => {
  if (!els.main.hidden) render();
});
