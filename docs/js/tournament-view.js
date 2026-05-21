import { initSidebar } from "./sidebar.js";
import { t, tournamentStatusLabel } from "./i18n.js";
import { loadTeamContext } from "./team-context.js";
import { db } from "./firebase-config.js";
import {
  doc,
  getDoc,
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

initSidebar("tournaments-list");

const els = {
  noTeam: document.getElementById("no-team"),
  main: document.getElementById("main"),
  emptyBanner: document.getElementById("empty-banner"),
  tTitle: document.getElementById("t-title"),
  tMeta: document.getElementById("t-meta"),

  // Hero
  heroCard: document.getElementById("hero-team-card"),
  heroRank: document.getElementById("hero-rank"),
  heroName: document.getElementById("hero-name"),
  heroYouBadge: document.getElementById("hero-you-badge"),
  heroScore: document.getElementById("hero-score"),
  heroCoop: document.getElementById("hero-coop"),
  heroAvg: document.getElementById("hero-avg"),
  heroNarrative: document.getElementById("hero-narrative"),
  podium: document.getElementById("podium"),
  podiumExtras: document.getElementById("podium-extras"),
  podiumTitle: document.getElementById("podium-title"),
  heroRadar: document.getElementById("hero-radar"),

  // Mid row
  matrixTable: document.getElementById("matrix-table"),
  outcomesDonut: document.getElementById("outcomes-donut"),
  outcomesTotal: document.getElementById("outcomes-total"),
  outcomesWins: document.getElementById("outcomes-wins"),
  outcomesLosses: document.getElementById("outcomes-losses"),
  outcomesTies: document.getElementById("outcomes-ties"),

  // Bottom: matches table
  matchesEmpty: document.getElementById("matches-empty"),
  matchesContent: document.getElementById("matches-content"),
  filterTeam: document.getElementById("filter-team"),
  filterResult: document.getElementById("filter-result"),
  filterOpponent: document.getElementById("filter-opponent"),
  filterReset: document.getElementById("filter-reset"),
  matchesTbody: document.getElementById("matches-tbody"),
  matchesNoResult: document.getElementById("matches-no-result"),

  // Bottom: match preview
  previewEmpty: document.getElementById("preview-empty"),
  previewContent: document.getElementById("preview-content"),
  prevTeamAEmoji: document.getElementById("prev-team-a-emoji"),
  prevTeamBEmoji: document.getElementById("prev-team-b-emoji"),
  prevTeamAName: document.getElementById("prev-team-a-name"),
  prevTeamBName: document.getElementById("prev-team-b-name"),
  prevScoreA: document.getElementById("prev-score-a"),
  prevScoreB: document.getElementById("prev-score-b"),
  prevResult: document.getElementById("prev-result"),
  prevMeta: document.getElementById("prev-meta"),
  previewHistory: document.getElementById("preview-history"),
  previewNarrative: document.getElementById("preview-narrative")
};

const params = new URLSearchParams(window.location.search);
const tournamentId = params.get("t");
if (!tournamentId) window.location.href = "tournaments.html";

let context = null;
let tournamentData = null;
let teams = [];                  // [{id, display_name, emoji, ...}]
let leaderboard = null;          // { scores, wins, losses, ties, coop, avg_score }
let matches = [];                // raw match docs
let teamProfile = {};            // teamId → {profile, stats}
let focusedTeamId = null;        // hero/donut/matrix focus
let radarChart = null;
let outcomesChart = null;

// Strategy buckets used in the matchup matrix (mockup labels).
const STRATEGY_BUCKETS = ["tit_for_tat", "cooperative", "neutral", "random", "aggressive", "exploiter"];

// Deterministic comparator for [teamId, score] entries : sort by score desc,
// then alphabetically by team display_name asc (so ties always resolve the
// same way across refreshes).
function scoreThenName(a, b) {
  if (b[1] !== a[1]) return b[1] - a[1];
  const aName = teams.find((tm) => tm.id === a[0])?.display_name || a[0];
  const bName = teams.find((tm) => tm.id === b[0])?.display_name || b[0];
  return aName.localeCompare(bName);
}

loadTeamContext({
  allowAdmin: true,
  onLoaded: async (ctx) => {
    context = ctx;
    els.main.hidden = false;
    els.main.classList.toggle("admin-view", !!ctx.isAdmin);
    // Role-aware back link + logo. Default HTML targets the team paths;
    // admin viewers need to go back to admin.html instead.
    const backLink = document.getElementById("back-link");
    if (backLink) backLink.href = ctx.isAdmin ? "admin.html" : "tournaments.html";
    const logo = document.querySelector(".sidebar-header .logo");
    if (logo) logo.href = ctx.isAdmin ? "admin.html" : "team.html";
    await Promise.all([loadTournament(), loadTeams(), loadLeaderboard(), loadMatches()]);
    // pre-results state : no leaderboard yet → collapse the layout to just
    // the registered-teams card. Otherwise the team sees a dashboard of
    // empty placeholders (radar, donut, matches, preview).
    const hasLeaderboard = !!(leaderboard?.scores && Object.keys(leaderboard.scores).length > 0);
    els.main.classList.toggle("pre-results", !hasLeaderboard);
    computeProfiles();
    pickFocusedTeam();
    renderHeader();
    renderHero();
    renderPodium();
    renderRadar();
    renderMatrix();
    renderOutcomes();
    renderMatches();
  },
  onNoTeam: () => { els.noTeam.hidden = false; }
});

// ---------- Loaders ----------
async function loadTournament() {
  const snap = await getDoc(doc(db, "tournaments", tournamentId));
  if (!snap.exists()) { window.location.href = "tournaments.html"; return; }
  tournamentData = snap.data();
}

async function loadTeams() {
  const partsSnap = await getDocs(collection(db, "tournaments", tournamentId, "teams"));
  if (partsSnap.empty) { teams = []; return; }
  const parts = [];
  partsSnap.forEach((d) => parts.push({ id: d.id, ...d.data() }));
  const teamDocs = await Promise.all(parts.map((p) => getDoc(doc(db, "teams", p.id))));
  teams = parts.map((p, idx) => {
    const td = teamDocs[idx];
    const tdata = td.exists() ? td.data() : { display_name: p.id, emoji: "" };
    return {
      id: p.id,
      display_name: tdata.display_name,
      emoji: tdata.emoji,
      bot_name: p.bot_name || null
    };
  });
}

async function loadLeaderboard() {
  try {
    const snap = await getDocs(collection(db, "tournaments", tournamentId, "leaderboards"));
    if (snap.empty) { leaderboard = null; return; }
    let latest = null;
    snap.forEach((d) => {
      const data = d.data();
      const updatedAt = data.updated_at?.toMillis?.() ?? 0;
      if (!latest || updatedAt > latest.updated_at_ms) {
        latest = { id: d.id, ...data, updated_at_ms: updatedAt };
      }
    });
    leaderboard = latest;
  } catch {
    leaderboard = null;
  }
}

async function loadMatches() {
  try {
    const snap = await getDocs(collection(db, "tournaments", tournamentId, "matches"));
    matches = [];
    snap.forEach((d) => matches.push({ id: d.id, ...d.data() }));
    matches.sort((a, b) => (b.played_at?.toMillis?.() ?? 0) - (a.played_at?.toMillis?.() ?? 0));
  } catch {
    matches = [];
  }
}

// ---------- Strategy classification ----------
// Port of sandbox.py:analyze_strategy, aggregated across all of a team's matches.
function computeProfiles() {
  teamProfile = {};
  for (const tm of teams) {
    const seqs = collectTeamSequences(tm.id);
    if (seqs.length === 0) { teamProfile[tm.id] = { profile: "no_data", stats: {} }; continue; }
    const stats = aggregateStats(seqs);
    teamProfile[tm.id] = { profile: classify(stats), stats };
  }
}

function collectTeamSequences(teamId) {
  const out = [];
  for (const m of matches) {
    if (m.team_a_id === teamId && m.history_a) out.push({ my: m.history_a, opp: m.history_b || "" });
    else if (m.team_b_id === teamId && m.history_b) out.push({ my: m.history_b, opp: m.history_a || "" });
  }
  return out;
}

function aggregateStats(seqs) {
  // Compute analyze_strategy metrics for each sequence, then average.
  let coop = 0, react = 0, forg = 0, retal = 0, pavl = 0, run = 0;
  let count = 0;
  for (const s of seqs) {
    const m = s.my, o = s.opp;
    const n = Math.min(m.length, o.length);
    if (n < 2) continue;
    let coopHits = 0, reactHits = 0, forgChances = 0, forgHits = 0, retalHits = 0;
    let pavlHits = 0, pavlTotal = 0, runs = 1;
    for (let i = 0; i < n; i++) if (m[i] === "C") coopHits++;
    for (let i = 1; i < n; i++) {
      if (m[i] === o[i - 1]) reactHits++;
      if (o[i - 1] === "D") {
        forgChances++;
        if (m[i] === "C") forgHits++;
        else if (m[i] === "D") retalHits++;
      }
      const lastMe = m[i - 1], lastOp = o[i - 1];
      const won = (lastMe === "C" && lastOp === "C") || (lastMe === "D" && lastOp === "C");
      const expected = won ? lastMe : (lastMe === "C" ? "D" : "C");
      if (m[i] === expected) pavlHits++;
      pavlTotal++;
      if (m[i] !== m[i - 1]) runs++;
    }
    coop += coopHits / n;
    react += reactHits / Math.max(1, n - 1);
    forg += forgChances > 0 ? forgHits / forgChances : 0;
    retal += forgChances > 0 ? retalHits / forgChances : 0;
    pavl += pavlHits / Math.max(1, pavlTotal);
    run += n / runs;
    count++;
  }
  if (count === 0) return null;
  return {
    coop_rate: coop / count,
    reactivity: react / count,
    forgiveness: forg / count,
    retaliation: retal / count,
    pavlov_score: pavl / count,
    avg_run: run / count
  };
}

// Map analyze_strategy metrics into one of the matrix buckets.
function classify(s) {
  if (!s) return "no_data";
  const c = s.coop_rate;
  if (c >= 0.85) return "cooperative";
  if (c <= 0.20) return s.retaliation > 0.5 ? "exploiter" : "aggressive";
  if (s.reactivity >= 0.75 && c >= 0.30 && c <= 0.75) return "tit_for_tat";
  if (s.forgiveness >= 0.5 && c >= 0.45) return "cooperative";
  if (s.retaliation >= 0.65 && s.forgiveness <= 0.20) return "exploiter";
  if (s.avg_run < 1.7) return "random";
  return "neutral";
}

function bucketLabel(b) {
  return t(`tournament.view.matrix.bucket.${b}`);
}

// ---------- Focused team ----------
function pickFocusedTeam() {
  // Team users : their own team. Admin or unaffiliated viewers : the #1 team.
  if (context?.uid && teams.some((tm) => tm.id === context.uid)) {
    focusedTeamId = context.uid;
    return;
  }
  if (leaderboard?.scores) {
    const sorted = Object.entries(leaderboard.scores).sort(scoreThenName);
    if (sorted.length > 0) focusedTeamId = sorted[0][0];
  }
}

// ---------- Header ----------
function renderHeader() {
  if (!tournamentData) return;
  els.tTitle.textContent = tournamentData.name;
  const statusKey = tournamentData.status || "open_submission";
  // Teams don't see nb_turns — they must build a strategy robust to an
  // unknown horizon. Admin gets the full meta.
  let metaText = context?.isAdmin
    ? t("tournament.meta", {
        phase: tournamentData.phase,
        turns: tournamentData.nb_turns,
        noise: (tournamentData.noise_level * 100).toFixed(0),
        status: tournamentStatusLabel(statusKey)
      })
    : t("tournament.meta.team", {
        phase: tournamentData.phase,
        noise: (tournamentData.noise_level * 100).toFixed(0),
        status: tournamentStatusLabel(statusKey)
      });
  // Append the relevant date (completed → completed_at, otherwise launched_at
  // or created_at) so the team can locate the tournament in time without us
  // taking up a column in the matches table.
  const locale = document.documentElement.lang === "fr" ? "fr-FR" : "en-GB";
  const dateTs = tournamentData.completed_at || tournamentData.launched_at || tournamentData.created_at;
  if (dateTs?.toDate) {
    metaText += " · " + dateTs.toDate().toLocaleDateString(locale);
  }
  els.tMeta.textContent = metaText;

  // Show "empty" banner if neither leaderboard nor matches yet
  const hasData = (leaderboard?.scores && Object.keys(leaderboard.scores).length > 0) || matches.length > 0;
  els.emptyBanner.hidden = hasData;
}

// ---------- Hero ----------
function renderHero() {
  // Admin viewers don't need the focused-team card — they're not playing,
  // and the rest of the dashboard already covers what they need.
  if (context?.isAdmin) {
    els.heroCard.hidden = true;
    return;
  }
  if (!focusedTeamId) {
    els.heroCard.hidden = true;
    return;
  }
  els.heroCard.hidden = false;

  const team = teams.find((tm) => tm.id === focusedTeamId);
  if (!team) { els.heroCard.hidden = true; return; }
  const lb = leaderboard || {};
  const score = lb.scores?.[focusedTeamId];
  const wins = lb.wins?.[focusedTeamId];
  const losses = lb.losses?.[focusedTeamId];
  const coop = lb.coop?.[focusedTeamId];
  const avg = lb.avg_score?.[focusedTeamId];

  // Rank from scores
  let rank = "—";
  if (lb.scores) {
    const sorted = Object.entries(lb.scores).sort(scoreThenName);
    const idx = sorted.findIndex(([id]) => id === focusedTeamId);
    if (idx >= 0) rank = `#${idx + 1}`;
  }

  els.heroRank.textContent = rank;
  els.heroName.textContent = (team.emoji ? team.emoji + " " : "") + team.display_name;
  els.heroYouBadge.hidden = team.id !== context?.uid;
  els.heroScore.textContent = score ?? "—";
  els.heroCoop.textContent = coop != null ? `${Math.round(coop * 100)}%` : "—";
  els.heroAvg.textContent = avg != null ? avg.toFixed(2) : "—";
  els.heroNarrative.textContent = narrativeFor(focusedTeamId);
}

function narrativeFor(teamId) {
  const prof = teamProfile[teamId];
  if (!prof || prof.profile === "no_data") return t("tournament.view.narrative.unknown");
  return t(`tournament.view.narrative.${prof.profile}`);
}

// ---------- Podium ----------
function renderPodium() {
  els.podium.innerHTML = "";
  if (els.podiumExtras) els.podiumExtras.innerHTML = "";

  // No leaderboard yet → show the list of registered teams instead of the
  // podium, with the section retitled "Registered teams".
  if (!leaderboard?.scores || Object.keys(leaderboard.scores).length === 0) {
    if (els.podiumTitle) els.podiumTitle.textContent = t("tournament.view.teams.title");
    if (teams.length === 0 || !els.podiumExtras) return;
    const sorted = [...teams].sort((a, b) => (a.display_name || "").localeCompare(b.display_name || ""));
    const myTeamId = context?.isAdmin ? null : context?.uid;
    sorted.forEach((tm) => {
      const isMe = myTeamId && tm.id === myTeamId;
      const li = document.createElement("li");
      li.className = "podium-extra" + (isMe ? " you" : "");
      li.innerHTML = `
        <span class="podium-extra-rank">${tm.emoji ? escapeHtml(tm.emoji) : "▣"}</span>
        <span class="podium-extra-name">${escapeHtml(tm.display_name)}</span>
        <span class="podium-extra-score muted small">${tm.bot_name ? "✓" : "—"}</span>
      `;
      els.podiumExtras.appendChild(li);
    });
    return;
  }

  // Leaderboard available → original podium + ranking list rendering.
  if (els.podiumTitle) els.podiumTitle.textContent = t("tournament.view.hero.podium");

  const sortedAll = Object.entries(leaderboard.scores)
    .map(([id, score]) => ({ id, score, team: teams.find((tm) => tm.id === id) }))
    .filter((e) => e.team)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (a.team.display_name || "").localeCompare(b.team.display_name || "");
    });
  if (sortedAll.length === 0) return;

  // Bare podium image — no overlays. Team identities live in the list below.
  const wrap = document.createElement("div");
  wrap.className = "podium-image-wrap";
  wrap.innerHTML = `<img src="imgs/leaderboard.png" alt="" class="podium-image" />`;
  els.podium.appendChild(wrap);

  if (!els.podiumExtras) return;

  // Full ranked list — every team. Container is scrollable (no visible
  // scrollbar). Viewer's own team is highlighted in cyan.
  const isAdmin = !!context?.isAdmin;
  const myTeamId = isAdmin ? null : context?.uid;
  sortedAll.forEach((entry, i) => {
    const rank = i + 1;
    const isMe = myTeamId && entry.id === myTeamId;
    els.podiumExtras.appendChild(buildExtraRow(rank, entry, isMe));
  });
}

function buildExtraRow(rank, entry, isMe) {
  const li = document.createElement("li");
  let cls = "podium-extra";
  if (rank >= 1 && rank <= 3) cls += ` podium-rank-${rank}`;
  if (isMe) cls += " you";
  li.className = cls;
  const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : null;
  const rankLabel = medal ? medal : `#${rank}`;
  li.innerHTML = `
    <span class="podium-extra-rank">${rankLabel}</span>
    <span class="podium-extra-name">${entry.team.emoji ? escapeHtml(entry.team.emoji) + " " : ""}${escapeHtml(entry.team.display_name)}</span>
    <span class="podium-extra-score">${entry.score}</span>
  `;
  return li;
}

// ---------- Behavioral radar ----------
async function renderRadar() {
  // Admin viewers don't get the behavioral radar — it's a team-side feature.
  if (context?.isAdmin) return;
  if (!focusedTeamId) return;
  const stats = teamProfile[focusedTeamId]?.stats;
  if (!stats) return;
  if (!window.Chart) {
    try {
      const mod = await import("https://cdn.jsdelivr.net/npm/chart.js@4.4.4/auto/+esm");
      window.Chart = mod.default || mod.Chart;
    } catch { return; }
  }
  const data = {
    cooperation: stats.coop_rate,
    aggression: 1 - stats.coop_rate,
    forgiveness: stats.forgiveness,
    stability: clamp01(1 - 1 / Math.max(1, stats.avg_run)),
    exploitability: Math.min(1, stats.forgiveness * (1 - stats.coop_rate) + 0.2 * (1 - clamp01(1 - 1 / Math.max(1, stats.avg_run))))
  };
  const labels = [
    t("strategies.profile.cooperation"),
    t("strategies.profile.aggression"),
    t("strategies.profile.forgiveness"),
    t("strategies.profile.stability"),
    t("strategies.profile.exploitability")
  ];
  const values = [data.cooperation, data.aggression, data.forgiveness, data.stability, data.exploitability]
    .map((x) => Math.round((x || 0) * 100));
  if (radarChart) { radarChart.destroy(); radarChart = null; }
  radarChart = new window.Chart(els.heroRadar, {
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

// ---------- Matchup matrix ----------
function renderMatrix() {
  // Only meaningful with matches available.
  if (matches.length === 0 || teams.length === 0) {
    els.matrixTable.innerHTML = `<tr><td class="muted small">${t("tournament.view.matrix.empty")}</td></tr>`;
    return;
  }

  // For each team, count W-L (and total score) versus each opponent bucket.
  // matrix[teamId][bucket] = { w, l, t, score }
  const matrix = {};
  for (const tm of teams) {
    matrix[tm.id] = {};
    for (const b of STRATEGY_BUCKETS) matrix[tm.id][b] = { w: 0, l: 0, t: 0, score: 0 };
  }
  for (const m of matches) {
    const aProf = teamProfile[m.team_a_id]?.profile;
    const bProf = teamProfile[m.team_b_id]?.profile;
    const sa = m.score_a ?? 0, sb = m.score_b ?? 0;
    if (matrix[m.team_a_id] && STRATEGY_BUCKETS.includes(bProf)) {
      const bucket = matrix[m.team_a_id][bProf];
      bucket.score += sa;
      if (sa > sb) bucket.w++; else if (sa < sb) bucket.l++; else bucket.t++;
    }
    if (matrix[m.team_b_id] && STRATEGY_BUCKETS.includes(aProf)) {
      const bucket = matrix[m.team_b_id][aProf];
      bucket.score += sb;
      if (sb > sa) bucket.w++; else if (sb < sa) bucket.l++; else bucket.t++;
    }
  }

  // Pick teams to display : the focused team first, then others sorted by score desc.
  let ordered = [...teams];
  ordered.sort((a, b) => {
    const da = leaderboard?.scores?.[a.id] ?? 0;
    const dbb = leaderboard?.scores?.[b.id] ?? 0;
    if (dbb !== da) return dbb - da;
    return (a.display_name || "").localeCompare(b.display_name || "");
  });
  if (focusedTeamId) {
    const idx = ordered.findIndex((tm) => tm.id === focusedTeamId);
    if (idx > 0) ordered = [ordered[idx], ...ordered.filter((tm) => tm.id !== focusedTeamId)];
  }

  // Render table
  const headRow = `
    <tr>
      <th></th>
      ${STRATEGY_BUCKETS.map((b) => `<th class="matrix-bucket">${escapeHtml(bucketLabel(b))}</th>`).join("")}
    </tr>
  `;
  const bodyRows = ordered.slice(0, 8).map((tm) => {
    const isFocus = tm.id === focusedTeamId;
    const cells = STRATEGY_BUCKETS.map((b) => {
      const c = matrix[tm.id][b];
      const total = c.w + c.l + c.t;
      if (total === 0) return `<td class="matrix-cell empty">—</td>`;
      const recordClass = c.w > c.l ? "win" : c.w < c.l ? "loss" : "tie";
      return `
        <td class="matrix-cell ${recordClass}">
          <div class="matrix-record">${c.w} - ${c.l}${c.t ? `<span class="muted"> · ${c.t}</span>` : ""}</div>
          <div class="matrix-score">${c.score}</div>
        </td>
      `;
    }).join("");
    return `
      <tr class="${isFocus ? "you" : ""}">
        <th class="matrix-team">
          ${tm.emoji ? `<span class="matrix-emoji">${escapeHtml(tm.emoji)}</span>` : ""}
          <span class="matrix-team-name">${escapeHtml(tm.display_name)}</span>
        </th>
        ${cells}
      </tr>
    `;
  }).join("");

  els.matrixTable.innerHTML = `<thead>${headRow}</thead><tbody>${bodyRows}</tbody>`;
}

// ---------- Outcomes donut ----------
async function renderOutcomes() {
  if (!leaderboard) return;
  let w, l, tt;
  if (context?.isAdmin) {
    // Aggregate across all teams. In a round-robin, sum(wins) == sum(losses)
    // (every win has a matching loss) and sum(ties) is 2× the tied match count.
    w = Object.values(leaderboard.wins || {}).reduce((a, b) => a + b, 0);
    l = Object.values(leaderboard.losses || {}).reduce((a, b) => a + b, 0);
    tt = Object.values(leaderboard.ties || {}).reduce((a, b) => a + b, 0);
  } else {
    if (!focusedTeamId) return;
    w = leaderboard.wins?.[focusedTeamId] || 0;
    l = leaderboard.losses?.[focusedTeamId] || 0;
    tt = leaderboard.ties?.[focusedTeamId] || 0;
  }
  const total = w + l + tt;
  els.outcomesTotal.textContent = total;
  els.outcomesWins.textContent = `${w} ${t("match.result.win_short")} (${total ? Math.round(w / total * 100) : 0}%)`;
  els.outcomesLosses.textContent = `${l} ${t("match.result.loss_short")} (${total ? Math.round(l / total * 100) : 0}%)`;
  els.outcomesTies.textContent = `${tt} ${t("match.result.tie_short")} (${total ? Math.round(tt / total * 100) : 0}%)`;

  if (!window.Chart) {
    try {
      const mod = await import("https://cdn.jsdelivr.net/npm/chart.js@4.4.4/auto/+esm");
      window.Chart = mod.default || mod.Chart;
    } catch { return; }
  }
  if (outcomesChart) { outcomesChart.destroy(); outcomesChart = null; }
  outcomesChart = new window.Chart(els.outcomesDonut, {
    type: "doughnut",
    data: {
      labels: [t("match.result.win_short"), t("match.result.loss_short"), t("match.result.tie_short")],
      datasets: [{
        data: [w, l, tt],
        backgroundColor: ["#7ddca0", "#ff7676", "#f5b942"],
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

// ---------- Matches table + filters ----------
function renderMatches() {
  if (matches.length === 0) {
    els.matchesEmpty.hidden = false;
    els.matchesContent.hidden = true;
    return;
  }
  els.matchesEmpty.hidden = true;
  els.matchesContent.hidden = false;
  populateTeamFilters();
  // Team users pre-filter to their own team (own matches first).
  // Admins start with "All" so the colour-coded WIN badges show.
  const myTeam = !context?.isAdmin && teams.find((tm) => tm.id === context?.uid);
  els.filterTeam.value = myTeam ? myTeam.id : "all";
  applyMatchFilters();
}

function populateTeamFilters() {
  const sorted = [...teams].sort((a, b) => (a.display_name || "").localeCompare(b.display_name || ""));
  const allOpt = `<option value="all">${escapeHtml(t("tournament.view.matches.filter.all"))}</option>`;
  const opts = sorted.map((tm) => {
    const label = tm.emoji ? `${tm.emoji} ${tm.display_name}` : tm.display_name;
    return `<option value="${escapeHtml(tm.id)}">${escapeHtml(label)}</option>`;
  }).join("");
  els.filterTeam.innerHTML = allOpt + opts;
  els.filterOpponent.innerHTML = allOpt + opts;
}

els.filterTeam.addEventListener("change", applyMatchFilters);
els.filterResult.addEventListener("change", applyMatchFilters);
els.filterOpponent.addEventListener("change", applyMatchFilters);
els.filterReset.addEventListener("click", () => {
  els.filterTeam.value = "all";
  els.filterResult.value = "all";
  els.filterOpponent.value = "all";
  applyMatchFilters();
});

function applyMatchFilters() {
  const teamFilter = els.filterTeam.value;
  const resultFilter = els.filterResult.value;
  const oppFilter = els.filterOpponent.value;

  els.filterResult.disabled = teamFilter === "all";
  els.filterOpponent.disabled = teamFilter === "all";
  if (teamFilter === "all") { els.filterResult.value = "all"; els.filterOpponent.value = "all"; }

  let filtered = matches;
  if (teamFilter !== "all") {
    filtered = filtered.filter((m) => m.team_a_id === teamFilter || m.team_b_id === teamFilter);
    if (oppFilter !== "all") {
      filtered = filtered.filter((m) => {
        const opp = m.team_a_id === teamFilter ? m.team_b_id : m.team_a_id;
        return opp === oppFilter;
      });
    }
    if (resultFilter !== "all") {
      filtered = filtered.filter((m) => {
        const isA = m.team_a_id === teamFilter;
        const mine = isA ? m.score_a : m.score_b;
        const opp = isA ? m.score_b : m.score_a;
        if (resultFilter === "win") return mine > opp;
        if (resultFilter === "loss") return mine < opp;
        return mine === opp;
      });
    }
  }

  renderMatchesTable(filtered, teamFilter);
}

function renderMatchesTable(list, referenceTeamId) {
  els.matchesTbody.innerHTML = "";
  if (list.length === 0) {
    els.matchesNoResult.hidden = false;
    return;
  }
  els.matchesNoResult.hidden = true;

  for (const m of list) {
    const teamA = teams.find((tm) => tm.id === m.team_a_id);
    const teamB = teams.find((tm) => tm.id === m.team_b_id);
    const aName = teamA?.display_name || m.team_a_name || m.team_a_id || "?";
    const bName = teamB?.display_name || m.team_b_name || m.team_b_id || "?";
    const aEmoji = teamA?.emoji || "";
    const bEmoji = teamB?.emoji || "";

    let resultLabel, resultClass;
    if (referenceTeamId && referenceTeamId !== "all") {
      const isA = m.team_a_id === referenceTeamId;
      const mine = isA ? m.score_a : m.score_b;
      const opp = isA ? m.score_b : m.score_a;
      if (mine > opp) { resultLabel = t("match.result.win_short"); resultClass = "ok"; }
      else if (mine < opp) { resultLabel = t("match.result.loss_short"); resultClass = "ko"; }
      else { resultLabel = t("match.result.tie_short"); resultClass = ""; }
    } else {
      // No reference team : show WIN colored to match the winning column
      // (team A is the cyan column, team B is the salmon column).
      if (m.score_a > m.score_b) { resultLabel = t("match.result.win_short"); resultClass = "win-a"; }
      else if (m.score_a < m.score_b) { resultLabel = t("match.result.win_short"); resultClass = "win-b"; }
      else { resultLabel = t("match.result.tie_short"); resultClass = ""; }
    }

    const tr = document.createElement("tr");
    tr.dataset.matchId = m.id;
    tr.innerHTML = `
      <td>
        <span class="match-row-team">
          ${aEmoji ? `<span class="match-row-emoji">${escapeHtml(aEmoji)}</span>` : ""}
          ${escapeHtml(aName)}
        </span>
      </td>
      <td class="num match-row-score">
        <span class="match-row-score-a">${m.score_a ?? 0}</span>
        <span class="muted"> – </span>
        <span class="match-row-score-b">${m.score_b ?? 0}</span>
      </td>
      <td>
        <span class="match-row-team">
          ${bEmoji ? `<span class="match-row-emoji">${escapeHtml(bEmoji)}</span>` : ""}
          ${escapeHtml(bName)}
        </span>
      </td>
      <td><span class="badge ${resultClass}">${escapeHtml(resultLabel)}</span></td>
      <td><button type="button" class="match-row-action" data-match-id="${escapeHtml(m.id)}">▶</button></td>
    `;
    tr.addEventListener("click", () => selectMatch(m.id));
    els.matchesTbody.appendChild(tr);
  }

  // Auto-select first match in preview if none yet
  const firstId = list[0]?.id;
  if (firstId) selectMatch(firstId);
}

// ---------- Selected match inline preview ----------
function selectMatch(matchId) {
  const m = matches.find((x) => x.id === matchId);
  if (!m) return;

  // Highlight selected row
  els.matchesTbody.querySelectorAll("tr").forEach((tr) => {
    tr.classList.toggle("selected", tr.dataset.matchId === matchId);
  });

  // Put focused team / current user on the left if applicable.
  let a_id = m.team_a_id, b_id = m.team_b_id;
  let sa = m.score_a ?? 0, sb = m.score_b ?? 0;
  let ha = m.history_a || "", hb = m.history_b || "";
  let a_name = m.team_a_name, b_name = m.team_b_name;
  const swapTo = focusedTeamId || context?.uid;
  if (swapTo === m.team_b_id) {
    [a_id, b_id] = [b_id, a_id];
    [sa, sb] = [sb, sa];
    [ha, hb] = [hb, ha];
    [a_name, b_name] = [b_name, a_name];
  }
  const tA = teams.find((tm) => tm.id === a_id) || { display_name: a_name || a_id, emoji: "" };
  const tB = teams.find((tm) => tm.id === b_id) || { display_name: b_name || b_id, emoji: "" };

  els.prevTeamAEmoji.textContent = tA.emoji || "▣";
  els.prevTeamBEmoji.textContent = tB.emoji || "▣";
  els.prevTeamAName.textContent = tA.display_name;
  els.prevTeamBName.textContent = tB.display_name;
  els.prevScoreA.textContent = sa;
  els.prevScoreB.textContent = sb;

  let resultKey, resultClass;
  if (sa > sb) { resultKey = "match.result.win_short"; resultClass = "ok"; }
  else if (sa < sb) { resultKey = "match.result.loss_short"; resultClass = "ko"; }
  else { resultKey = "match.result.tie_short"; resultClass = ""; }
  els.prevResult.textContent = t(resultKey);
  els.prevResult.className = `badge ${resultClass}`;

  const nbTurns = m.nb_turns || ha.length;
  els.prevMeta.textContent = t("tournament.view.preview.meta", { turns: nbTurns });

  renderPreviewHistory(ha, hb, tA, tB);

  els.previewNarrative.textContent = previewNarrative(ha, hb, sa, sb, tA, tB);

  els.previewEmpty.hidden = true;
  els.previewContent.hidden = false;
}

function previewNarrative(ha, hb, sa, sb, tA, tB) {
  if (!ha || !hb) return "";
  const coopA = rateOfC(ha), coopB = rateOfC(hb);
  const params = { team_a: tA?.display_name || "?", team_b: tB?.display_name || "?" };
  if (sa > sb && coopA >= 0.6) return t("tournament.view.preview.narr.win_coop", params);
  if (sa > sb && coopA < 0.3) return t("tournament.view.preview.narr.win_aggr", params);
  if (sa < sb && coopA >= 0.6) return t("tournament.view.preview.narr.loss_coop", params);
  if (sa < sb) return t("tournament.view.preview.narr.loss_aggr", params);
  if (sa === sb && coopA >= 0.6 && coopB >= 0.6) return t("tournament.view.preview.narr.tie_coop", params);
  return t("tournament.view.preview.narr.tie_other", params);
}

function renderPreviewHistory(ha, hb, teamA, teamB) {
  const n = Math.max(ha.length, hb.length);
  if (n === 0) { els.previewHistory.innerHTML = `<p class="muted small">${t("match.history.empty")}</p>`; return; }
  let headerCells = "", rowA = "", rowB = "";
  for (let i = 0; i < n; i++) {
    const showLabel = i === 0 || (i + 1) % 5 === 0;
    headerCells += `<span class="match-turn-label">${showLabel ? (i + 1) : ""}</span>`;
    const a = ha[i] || "";
    const b = hb[i] || "";
    rowA += `<span class="match-cell match-cell-${a === "C" ? "c" : a === "D" ? "d" : "x"}">${a}</span>`;
    rowB += `<span class="match-cell match-cell-${b === "C" ? "c" : b === "D" ? "d" : "x"}">${b}</span>`;
  }
  els.previewHistory.innerHTML = `
    <div class="match-history-row match-history-header">
      <span class="match-history-label">${t("match.history.turn")}</span>
      <div class="match-history-cells">${headerCells}</div>
    </div>
    <div class="match-history-row">
      <span class="match-history-label">${escapeHtml(teamA.display_name || "A")}</span>
      <div class="match-history-cells">${rowA}</div>
    </div>
    <div class="match-history-row">
      <span class="match-history-label">${escapeHtml(teamB.display_name || "B")}</span>
      <div class="match-history-cells">${rowB}</div>
    </div>
  `;
}

function rateOfC(history) {
  if (!history) return 0;
  let c = 0;
  for (const ch of history) if (ch === "C") c++;
  return c / history.length;
}

// ---------- Helpers ----------
function avatarUrl(seed) {
  return `https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${encodeURIComponent(seed || "team")}&backgroundColor=transparent`;
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
  if (!els.main.hidden) {
    renderHeader();
    renderHero();
    renderPodium();
    renderRadar();
    renderMatrix();
    renderOutcomes();
    renderMatches();
  }
});
