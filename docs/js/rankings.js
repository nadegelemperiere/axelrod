// Rankings — team-side browse view of all teams, ranked by cumulative
// points across all tournaments played.
// Reuses the admin teams layout (stat tiles, filter bar, cards/rows grid,
// side detail panel) but in read-only mode : no edit, no delete, no create.

import { onAuth } from "./auth.js";
import { initSidebar } from "./sidebar.js";
import { t } from "./i18n.js";
import { db } from "./firebase-config.js";
import {
  doc,
  getDoc,
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

initSidebar("rankings");

const els = {
  main: document.getElementById("main"),

  // Podium
  podiumCard: document.getElementById("hof-podium-card"),
  podium: document.getElementById("hof-podium"),

  // Stat tiles
  statTotalTeams: document.getElementById("stat-total-teams"),
  statActiveSub: document.getElementById("stat-active-sub"),
  statTopElo: document.getElementById("stat-top-elo"),
  statTopEloSub: document.getElementById("stat-top-elo-sub"),
  statAvgElo: document.getElementById("stat-avg-elo"),
  statMatches: document.getElementById("stat-matches"),
  statTournamentsSub: document.getElementById("stat-tournaments-sub"),

  // Filters & toggle
  filterSearch: document.getElementById("filter-search"),
  filterReset: document.getElementById("filter-reset"),

  // Grid & detail
  grid: document.getElementById("teams-grid"),
  empty: document.getElementById("teams-empty"),
  detail: document.getElementById("teams-detail"),
  detailClose: document.getElementById("detail-close"),
  detailHex: document.getElementById("detail-hex"),
  detailName: document.getElementById("detail-name"),
  detailEmail: document.getElementById("detail-email"),
  detailSummary: document.getElementById("detail-summary"),
  detailTournaments: document.getElementById("detail-tournaments")
};

let teams = [];
let tournaments = [];
let participationsByTeam = {};
let pointsByTeam = {};
let recordByTeam = {};
let selectedTeamId = null;
let viewerUid = null;
let viewMode = localStorage.getItem("axelrod.rankings.view") || "cards";
let sortState = JSON.parse(localStorage.getItem("axelrod.rankings.sort") || '{"col":"points","dir":"desc"}');

onAuth(async (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  viewerUid = user.uid;
  els.main.hidden = false;
  await refresh();
});

async function refresh() {
  await Promise.all([loadTeams(), loadTournaments()]);
  await Promise.all([loadParticipations(), loadAllMatchesAndCompute()]);
  renderPodium();
  renderStats();
  renderGrid();
  if (selectedTeamId && teams.some((t) => t.id === selectedTeamId)) {
    renderDetail(selectedTeamId);
  } else {
    selectedTeamId = null;
    setDetailVisible(false);
  }
}

// ---------- Loaders ----------
async function loadTeams() {
  const snap = await getDocs(collection(db, "teams"));
  teams = [];
  snap.forEach((d) => teams.push({ id: d.id, ...d.data() }));
}

async function loadTournaments() {
  const snap = await getDocs(collection(db, "tournaments"));
  tournaments = [];
  snap.forEach((d) => tournaments.push({ id: d.id, ...d.data() }));
}

async function loadParticipations() {
  participationsByTeam = {};
  for (const tm of teams) participationsByTeam[tm.id] = [];
  await Promise.all(tournaments.map(async (tt) => {
    try {
      const s = await getDocs(collection(db, "tournaments", tt.id, "teams"));
      s.forEach((d) => {
        const data = d.data();
        if (participationsByTeam[d.id]) {
          participationsByTeam[d.id].push({
            tournamentId: tt.id,
            tournamentName: tt.name,
            tournamentStatus: tt.status,
            botCode: data.bot_code,
            botValidationStatus: data.bot_validation_status,
            botName: data.bot_name
          });
        }
      });
    } catch { /* ignore */ }
  }));
}

// Loads every match across all tournaments, sums total points per team
// (raw IPD payoff matrix scores), tracks W/L/T records.
let totalMatches = 0;
async function loadAllMatchesAndCompute() {
  pointsByTeam = {};
  recordByTeam = {};
  totalMatches = 0;
  for (const tm of teams) {
    pointsByTeam[tm.id] = 0;
    recordByTeam[tm.id] = { wins: 0, losses: 0, ties: 0 };
  }
  const all = [];
  await Promise.all(tournaments.map(async (tt) => {
    try {
      const snap = await getDocs(collection(db, "tournaments", tt.id, "matches"));
      snap.forEach((d) => all.push({ id: d.id, ...d.data() }));
    } catch { /* ignore */ }
  }));
  totalMatches = all.length;

  for (const m of all) {
    const a = m.team_a_id, b = m.team_b_id;
    if (!(a in pointsByTeam) || !(b in pointsByTeam)) continue;
    const sa = m.score_a ?? 0, sb = m.score_b ?? 0;
    pointsByTeam[a] += sa;
    pointsByTeam[b] += sb;
    if (sa > sb) { recordByTeam[a].wins++; recordByTeam[b].losses++; }
    else if (sa < sb) { recordByTeam[a].losses++; recordByTeam[b].wins++; }
    else { recordByTeam[a].ties++; recordByTeam[b].ties++; }
  }
}

function winRateOf(teamId) {
  const r = recordByTeam[teamId];
  if (!r) return null;
  const total = r.wins + r.losses + r.ties;
  if (total === 0) return null;
  return r.wins / total;
}

// Count only completed tournaments per team — in-progress ones haven't
// contributed to the rankings yet.
function completedTournamentsCount(teamId) {
  const parts = participationsByTeam[teamId] || [];
  return parts.filter((p) => p.tournamentStatus === "completed").length;
}

// ---------- Podium ----------
function renderPodium() {
  els.podium.innerHTML = "";
  // Need at least 1 team that has played a match to show the podium.
  const playedTeams = teams.filter((tm) => {
    const r = recordByTeam[tm.id];
    return r && (r.wins + r.losses + r.ties) > 0;
  });
  if (playedTeams.length === 0) {
    els.podiumCard.hidden = true;
    return;
  }
  els.podiumCard.hidden = false;
  const top3 = [...playedTeams]
    .sort(byPointsThenName)
    .slice(0, 3);

  const wrap = document.createElement("div");
  wrap.className = "podium-image-wrap";
  wrap.innerHTML = `<img src="imgs/leaderboard.png" alt="" class="podium-image" />`;
  top3.forEach((entry, idx) => {
    const rank = idx + 1;
    const overlay = document.createElement("div");
    overlay.className = `podium-overlay podium-overlay-${rank}`;
    overlay.innerHTML = `
      <div class="podium-team-emoji">${entry.emoji ? escapeHtml(entry.emoji) : ""}</div>
      <div class="podium-team-name">${escapeHtml(entry.display_name)}</div>
      <div class="podium-team-score">${pointsByTeam[entry.id]} pts</div>
    `;
    wrap.appendChild(overlay);
  });
  els.podium.appendChild(wrap);
}

// ---------- Stats ----------
function renderStats() {
  const total = teams.length;
  const played = teams.filter((tm) => {
    const r = recordByTeam[tm.id];
    return r && (r.wins + r.losses + r.ties) > 0;
  });
  let topPts = -1, topName = "—";
  for (const tm of played) {
    const p = pointsByTeam[tm.id] || 0;
    // Strict greater wins; on tie, alphabetically-first display_name wins
    // so the tile is deterministic across refreshes.
    if (p > topPts || (p === topPts && (tm.display_name || "").localeCompare(topName) < 0)) {
      topPts = p;
      topName = tm.display_name;
    }
  }
  if (topPts < 0) topPts = 0;
  const avgPts = played.length > 0
    ? Math.round(played.reduce((acc, tm) => acc + (pointsByTeam[tm.id] || 0), 0) / played.length)
    : 0;
  // Only completed tournaments count for the rankings stat — in-progress
  // tournaments haven't produced any matches yet.
  const tournamentsCount = tournaments.filter((tt) => tt.status === "completed").length;

  els.statTotalTeams.textContent = total;
  els.statActiveSub.textContent = t("rankings.stat.teams.sub", { n: played.length });
  els.statTopElo.textContent = topPts || "—";
  els.statTopEloSub.textContent = topName;
  els.statAvgElo.textContent = avgPts;
  els.statMatches.textContent = totalMatches;
  els.statTournamentsSub.textContent = t("rankings.stat.matches.sub", { n: tournamentsCount });
}

// ---------- Filter ----------
els.filterSearch.addEventListener("input", renderGrid);
els.filterReset.addEventListener("click", () => {
  els.filterSearch.value = "";
  renderGrid();
});

function getFilteredTeams() {
  const q = (els.filterSearch.value || "").trim().toLowerCase();
  return teams.filter((tm) => !q || (tm.display_name || "").toLowerCase().includes(q));
}

// ---------- Grid (cards / rows toggle) ----------
function renderGrid() {
  const list = getFilteredTeams();
  // Sort by points desc by default in both modes (rows view can re-sort via headers).
  const sorted = viewMode === "rows" ? sortTeamsList(list) : [...list].sort(byPointsThenName);

  els.grid.innerHTML = "";
  els.grid.classList.toggle("as-cards", viewMode === "cards");
  els.grid.classList.toggle("as-rows", viewMode === "rows");
  if (sorted.length === 0) { els.empty.hidden = false; return; }
  els.empty.hidden = true;

  if (viewMode === "rows") {
    renderRowsView(sorted);
    return;
  }

  for (const tm of sorted) {
    const points = pointsByTeam[tm.id] ?? 0;
    const wr = winRateOf(tm.id);
    const wrLabel = wr == null ? "—" : `${Math.round(wr * 100)}%`;
    const parts = participationsByTeam[tm.id] || [];
    const isYou = tm.id === viewerUid;

    const card = document.createElement("article");
    card.className = "team-card-admin" + (tm.id === selectedTeamId ? " selected" : "");
    card.innerHTML = `
      <div class="team-card-head">
        <span class="team-card-hex">${tm.emoji || "▣"}</span>
        <div class="team-card-headbody">
          <h4 class="team-card-name">
            ${escapeHtml(tm.display_name)}
            ${isYou ? `<span class="you-badge">${escapeHtml(t("tournament.view.your_team_badge"))}</span>` : ""}
          </h4>
          ${tm.email ? `<p class="team-card-email muted small">${escapeHtml(tm.email)}</p>` : ""}
        </div>
      </div>
      <div class="team-card-stats">
        <div><span class="team-card-stat-label">${escapeHtml(t("teams.card.stat.points"))}</span><span class="team-card-stat-value">${points}</span></div>
        <div><span class="team-card-stat-label">${escapeHtml(t("teams.card.stat.winrate"))}</span><span class="team-card-stat-value">${wrLabel}</span></div>
        <div><span class="team-card-stat-label">${escapeHtml(t("teams.card.stat.tournaments"))}</span><span class="team-card-stat-value">${completedTournamentsCount(tm.id)}</span></div>
      </div>
    `;
    card.addEventListener("click", () => selectTeam(tm.id));
    els.grid.appendChild(card);
  }
}

function sortTeamsList(list) {
  const valueOf = (tm, col) => {
    const parts = participationsByTeam[tm.id] || [];
    switch (col) {
      case "team": return (tm.display_name || "").toLowerCase();
      case "email": return (tm.email || "").toLowerCase();
      case "points": return pointsByTeam[tm.id] ?? 0;
      case "winrate": return winRateOf(tm.id) ?? -1;
      case "tournaments": return completedTournamentsCount(tm.id);
      default: return 0;
    }
  };
  const dir = sortState.dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    const va = valueOf(a, sortState.col);
    const vb = valueOf(b, sortState.col);
    let cmp;
    if (typeof va === "string" || typeof vb === "string") {
      cmp = String(va).localeCompare(String(vb)) * dir;
    } else {
      cmp = (va - vb) * dir;
    }
    // Deterministic tie-break by team display_name asc (regardless of dir).
    if (cmp === 0) {
      cmp = (a.display_name || "").localeCompare(b.display_name || "");
    }
    return cmp;
  });
}

// Deterministic comparator : sort teams by points desc, alphabetically asc
// on tie. Used wherever the main ranking display happens.
function byPointsThenName(a, b) {
  const pa = pointsByTeam[a.id] || 0;
  const pb = pointsByTeam[b.id] || 0;
  if (pb !== pa) return pb - pa;
  return (a.display_name || "").localeCompare(b.display_name || "");
}

function renderRowsView(list) {
  const header = document.createElement("div");
  header.className = "team-row-admin team-row-header hof-row";
  const cols = [
    { key: null, label: "" },
    { key: "team", label: t("teams.row.col.team") },
    { key: "email", label: t("teams.row.col.email") },
    { key: "points", label: t("teams.card.stat.points"), num: true },
    { key: "winrate", label: t("teams.card.stat.winrate"), num: true },
    { key: "tournaments", label: t("teams.card.stat.tournaments"), num: true }
  ];
  header.innerHTML = cols.map((c) => {
    if (!c.key) return `<span></span>`;
    const active = sortState.col === c.key;
    const arrow = active ? (sortState.dir === "asc" ? "▲" : "▼") : "";
    return `<span class="sort-header ${c.num ? "num" : ""} ${active ? "active" : ""}" data-sort="${c.key}">${escapeHtml(c.label)} <span class="sort-arrow">${arrow}</span></span>`;
  }).join("");
  els.grid.appendChild(header);

  header.querySelectorAll("[data-sort]").forEach((el) => {
    el.addEventListener("click", () => {
      const col = el.dataset.sort;
      const isNum = ["points", "winrate", "tournaments"].includes(col);
      if (sortState.col === col) sortState.dir = sortState.dir === "asc" ? "desc" : "asc";
      else { sortState.col = col; sortState.dir = isNum ? "desc" : "asc"; }
      localStorage.setItem("axelrod.rankings.sort", JSON.stringify(sortState));
      renderGrid();
    });
  });

  for (const tm of list) {
    const points = pointsByTeam[tm.id] ?? 0;
    const wr = winRateOf(tm.id);
    const wrLabel = wr == null ? "—" : `${Math.round(wr * 100)}%`;
    const parts = participationsByTeam[tm.id] || [];
    const isYou = tm.id === viewerUid;

    const row = document.createElement("div");
    row.className = "team-row-admin hof-row" + (tm.id === selectedTeamId ? " selected" : "");
    row.innerHTML = `
      <span class="team-row-emoji">${tm.emoji || "▣"}</span>
      <span class="team-row-name">${escapeHtml(tm.display_name)}${isYou ? ` <span class="you-badge">${escapeHtml(t("tournament.view.your_team_badge"))}</span>` : ""}</span>
      <span class="team-row-email muted">${escapeHtml(tm.email || "—")}</span>
      <span class="num">${points}</span>
      <span class="num">${wrLabel}</span>
      <span class="num">${completedTournamentsCount(tm.id)}</span>
    `;
    row.addEventListener("click", () => selectTeam(tm.id));
    els.grid.appendChild(row);
  }
}

// View toggle
document.querySelectorAll(".view-toggle-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.mode;
    if (mode === viewMode) return;
    viewMode = mode;
    localStorage.setItem("axelrod.rankings.view", mode);
    document.querySelectorAll(".view-toggle-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.mode === viewMode);
    });
    renderGrid();
  });
});
document.querySelectorAll(".view-toggle-btn").forEach((b) => {
  b.classList.toggle("active", b.dataset.mode === viewMode);
});

// ---------- Detail panel ----------
function setDetailVisible(visible) {
  els.detail.hidden = !visible;
  els.main.classList.toggle("with-detail", visible);
}

function selectTeam(teamId) {
  selectedTeamId = teamId;
  renderGrid();
  renderDetail(teamId);
}

function renderDetail(teamId) {
  const tm = teams.find((t) => t.id === teamId);
  if (!tm) { setDetailVisible(false); return; }
  setDetailVisible(true);

  els.detailHex.textContent = tm.emoji || "▣";
  els.detailName.textContent = tm.display_name;
  els.detailEmail.textContent = tm.email || t("teams.detail.no_email");

  const parts = participationsByTeam[teamId] || [];
  const points = pointsByTeam[teamId] ?? 0;
  const r = recordByTeam[teamId] || { wins: 0, losses: 0, ties: 0 };
  const wr = winRateOf(teamId);
  const wrLabel = wr == null ? "—" : `${Math.round(wr * 100)}%`;
  const created = tm.created_at?.toDate?.()?.toLocaleDateString(
    document.documentElement.lang === "fr" ? "fr-FR" : "en-GB"
  ) || "—";

  els.detailSummary.innerHTML = `
    <li><span>${escapeHtml(t("teams.detail.created"))}</span><span>${escapeHtml(created)}</span></li>
    <li><span>${escapeHtml(t("teams.detail.points"))}</span><span>${points}</span></li>
    <li><span>${escapeHtml(t("teams.detail.winrate"))}</span><span>${wrLabel}</span></li>
    <li><span>${escapeHtml(t("rankings.detail.wins"))}</span><span>${r.wins}</span></li>
    <li><span>${escapeHtml(t("rankings.detail.losses"))}</span><span>${r.losses}</span></li>
    <li><span>${escapeHtml(t("rankings.detail.ties"))}</span><span>${r.ties}</span></li>
    <li><span>${escapeHtml(t("teams.detail.tournaments_count"))}</span><span>${completedTournamentsCount(teamId)}</span></li>
  `;

  if (parts.length === 0) {
    els.detailTournaments.innerHTML = `<li class="muted small">${escapeHtml(t("teams.detail.no_tournament"))}</li>`;
  } else {
    els.detailTournaments.innerHTML = parts.map((p) => {
      const statusLabel = t(`admin.status.${p.tournamentStatus || "open_submission"}`);
      return `
        <li>
          <a href="tournament-view.html?t=${encodeURIComponent(p.tournamentId)}" class="detail-tournament-link">
            <span>${escapeHtml(p.tournamentName)}</span>
            <span class="muted small">${escapeHtml(statusLabel)}</span>
          </a>
        </li>
      `;
    }).join("");
  }
}

els.detailClose.addEventListener("click", () => {
  selectedTeamId = null;
  setDetailVisible(false);
  renderGrid();
});

document.addEventListener("langchange", () => {
  if (!els.main.hidden) {
    renderPodium();
    renderStats();
    renderGrid();
    if (selectedTeamId) renderDetail(selectedTeamId);
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}
