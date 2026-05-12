import { onAuth, isUserAdmin } from "./auth.js";
import { initSidebar } from "./sidebar.js";
import { t } from "./i18n.js";
import { db } from "./firebase-config.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

initSidebar("admin-teams");

const els = {
  accessDenied: document.getElementById("access-denied"),
  main: document.getElementById("main"),

  // Stat tiles
  statTotalTeams: document.getElementById("stat-total-teams"),
  statActiveTeams: document.getElementById("stat-active-teams"),
  statTotalStrategies: document.getElementById("stat-total-strategies"),
  statStrategiesAvg: document.getElementById("stat-strategies-avg"),
  statRunningTournaments: document.getElementById("stat-running-tournaments"),
  statParticipating: document.getElementById("stat-participating"),
  statIssues: document.getElementById("stat-issues"),
  statEmpty: document.getElementById("stat-empty"),

  // Filters
  filterSearch: document.getElementById("filter-search"),
  filterTournament: document.getElementById("filter-tournament"),
  filterBot: document.getElementById("filter-bot"),
  filterReset: document.getElementById("filter-reset"),

  // Grid & detail
  grid: document.getElementById("teams-grid"),
  empty: document.getElementById("teams-empty"),
  detail: document.getElementById("teams-detail"),
  detailClose: document.getElementById("detail-close"),
  detailHex: document.getElementById("detail-hex"),
  detailName: document.getElementById("detail-name"),
  detailUid: document.getElementById("detail-uid"),
  detailSummary: document.getElementById("detail-summary"),
  detailTournaments: document.getElementById("detail-tournaments"),
  actionEdit: document.getElementById("action-edit"),
  actionDelete: document.getElementById("action-delete"),

  // Modal
  openCreateBtn: document.getElementById("open-create-btn"),
  teamModal: document.getElementById("team-modal"),
  teamModalTitle: document.getElementById("team-modal-title"),
  teamForm: document.getElementById("team-form"),
  formMsg: document.getElementById("form-msg"),
  submitBtn: document.getElementById("team-submit-btn"),
  inputName: document.getElementById("t-name"),
  inputEmoji: document.getElementById("t-emoji"),
  inputEmail: document.getElementById("t-email"),
  inputUid: document.getElementById("t-uid")
};

let teams = [];                    // [{id, display_name, emoji, email, created_at}]
let tournaments = [];              // [{id, name, status, nb_turns, noise_level}]
let participationsByTeam = {};     // teamId → [{tournamentId, status, bot?}]
let strategiesCountByTeam = {};    // teamId → count
let eloByTeam = {};                // teamId → number (computed)
let recordByTeam = {};             // teamId → { wins, losses, ties }
let selectedTeamId = null;
let editingTeamId = null;
let viewMode = localStorage.getItem("axelrod.teams.view") || "cards"; // "cards" | "rows"

onAuth(async (user) => {
  if (!user) { window.location.href = "index.html"; return; }
  const admin = await isUserAdmin(user.uid);
  if (!admin) { els.accessDenied.hidden = false; return; }
  els.main.hidden = false;
  await refresh();
});

// ---------- Loaders ----------
async function refresh() {
  await Promise.all([loadTeams(), loadTournaments()]);
  await Promise.all([loadStrategiesCount(), loadParticipations(), loadAllMatchesAndCompute()]);
  renderStats();
  populateTournamentFilter();
  renderGrid();
  if (selectedTeamId && teams.some((t) => t.id === selectedTeamId)) {
    renderDetail(selectedTeamId);
  } else {
    selectedTeamId = null;
    setDetailVisible(false);
  }
}

// Loads every match across all tournaments, processes them chronologically
// to compute ELO ratings + win/loss/tie records per team. Single global ELO
// across all tournaments (resets between sessions, not persisted in DB).
async function loadAllMatchesAndCompute() {
  eloByTeam = {};
  recordByTeam = {};
  for (const tm of teams) {
    eloByTeam[tm.id] = 1500;
    recordByTeam[tm.id] = { wins: 0, losses: 0, ties: 0 };
  }
  const all = [];
  await Promise.all(tournaments.map(async (tt) => {
    try {
      const snap = await getDocs(collection(db, "tournaments", tt.id, "matches"));
      snap.forEach((d) => all.push({ id: d.id, ...d.data() }));
    } catch { /* ignore */ }
  }));
  // Chronological order matters for ELO updates.
  all.sort((a, b) => (a.played_at?.toMillis?.() ?? 0) - (b.played_at?.toMillis?.() ?? 0));

  const K = 32;
  for (const m of all) {
    const a = m.team_a_id, b = m.team_b_id;
    if (!eloByTeam[a] || !eloByTeam[b]) continue;  // skip orphans
    const sa = m.score_a ?? 0, sb = m.score_b ?? 0;
    let Sa, Sb;
    if (sa > sb) { Sa = 1; Sb = 0; recordByTeam[a].wins++; recordByTeam[b].losses++; }
    else if (sa < sb) { Sa = 0; Sb = 1; recordByTeam[a].losses++; recordByTeam[b].wins++; }
    else { Sa = 0.5; Sb = 0.5; recordByTeam[a].ties++; recordByTeam[b].ties++; }
    const Ra = eloByTeam[a], Rb = eloByTeam[b];
    const Ea = 1 / (1 + Math.pow(10, (Rb - Ra) / 400));
    const Eb = 1 - Ea;
    eloByTeam[a] = Math.round(Ra + K * (Sa - Ea));
    eloByTeam[b] = Math.round(Rb + K * (Sb - Eb));
  }
}

function winRateOf(teamId) {
  const r = recordByTeam[teamId];
  if (!r) return null;
  const total = r.wins + r.losses + r.ties;
  if (total === 0) return null;
  return r.wins / total;
}

async function loadTeams() {
  const snap = await getDocs(collection(db, "teams"));
  teams = [];
  snap.forEach((d) => teams.push({ id: d.id, ...d.data() }));
  teams.sort((a, b) => (a.created_at?.toMillis?.() ?? 0) - (b.created_at?.toMillis?.() ?? 0));
}

async function loadTournaments() {
  const snap = await getDocs(collection(db, "tournaments"));
  tournaments = [];
  snap.forEach((d) => tournaments.push({ id: d.id, ...d.data() }));
}

async function loadStrategiesCount() {
  strategiesCountByTeam = {};
  await Promise.all(teams.map(async (tm) => {
    try {
      const s = await getDocs(collection(db, "teams", tm.id, "strategies"));
      strategiesCountByTeam[tm.id] = s.size;
    } catch { strategiesCountByTeam[tm.id] = 0; }
  }));
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

// ---------- Stats ----------
function renderStats() {
  const totalTeams = teams.length;
  const teamsWithBot = teams.filter((tm) => (participationsByTeam[tm.id] || []).some((p) => !!p.botCode)).length;
  const totalStrategies = Object.values(strategiesCountByTeam).reduce((a, b) => a + b, 0);
  const avgStrategies = totalTeams > 0 ? (totalStrategies / totalTeams).toFixed(1) : "0";
  const runningT = tournaments.filter((tt) => (tt.status || "open_submission") !== "completed").length;
  const totalParticipations = Object.values(participationsByTeam).reduce((a, p) => a + p.length, 0);
  const issues = Object.values(participationsByTeam).reduce((acc, parts) => acc + parts.filter((p) => p.botValidationStatus === "error").length, 0);
  const empty = teams.filter((tm) => (strategiesCountByTeam[tm.id] || 0) === 0).length;

  els.statTotalTeams.textContent = totalTeams;
  els.statActiveTeams.textContent = t("teams.stat.total.sub", { n: teamsWithBot });
  els.statTotalStrategies.textContent = totalStrategies;
  els.statStrategiesAvg.textContent = t("teams.stat.strategies.sub", { n: avgStrategies });
  els.statRunningTournaments.textContent = runningT;
  els.statParticipating.textContent = t("teams.stat.running.sub", { n: totalParticipations });
  els.statIssues.textContent = issues;
  els.statEmpty.textContent = empty;
}

// ---------- Filter dropdown ----------
function populateTournamentFilter() {
  const all = `<option value="all">${escapeHtml(t("teams.filter.all_tournaments"))}</option>`;
  const opts = tournaments
    .slice()
    .sort((a, b) => (b.created_at?.toMillis?.() ?? 0) - (a.created_at?.toMillis?.() ?? 0))
    .map((tt) => `<option value="${escapeHtml(tt.id)}">${escapeHtml(tt.name)}</option>`)
    .join("");
  els.filterTournament.innerHTML = all + opts;
}

// Re-render on filter change
[els.filterSearch, els.filterTournament, els.filterBot].forEach((el) => {
  el.addEventListener("input", renderGrid);
  el.addEventListener("change", renderGrid);
});
els.filterReset.addEventListener("click", () => {
  els.filterSearch.value = "";
  els.filterTournament.value = "all";
  els.filterBot.value = "all";
  renderGrid();
});

function getFilteredTeams() {
  const q = (els.filterSearch.value || "").trim().toLowerCase();
  const tFilter = els.filterTournament.value;
  const bFilter = els.filterBot.value;
  return teams.filter((tm) => {
    if (q && !((tm.display_name || "").toLowerCase().includes(q))) return false;
    const parts = participationsByTeam[tm.id] || [];
    if (tFilter !== "all" && !parts.some((p) => p.tournamentId === tFilter)) return false;
    if (bFilter !== "all") {
      const hasBot = parts.some((p) => !!p.botCode);
      const hasOk = parts.some((p) => p.botValidationStatus === "ok");
      const hasKo = parts.some((p) => p.botValidationStatus === "error");
      if (bFilter === "ok" && !hasOk) return false;
      if (bFilter === "ko" && !hasKo) return false;
      if (bFilter === "none" && hasBot) return false;
    }
    return true;
  });
}

// ---------- Grid (mode-aware) ----------
function renderGrid() {
  const list = getFilteredTeams();
  els.grid.innerHTML = "";
  // Toggle the container class so CSS can switch layouts.
  els.grid.classList.toggle("as-cards", viewMode === "cards");
  els.grid.classList.toggle("as-rows", viewMode === "rows");
  if (list.length === 0) {
    els.empty.hidden = false;
    return;
  }
  els.empty.hidden = true;

  if (viewMode === "rows") {
    renderRowsView(list);
    return;
  }

  for (const tm of list) {
    const parts = participationsByTeam[tm.id] || [];
    const hasBotCount = parts.filter((p) => !!p.botCode).length;
    const koCount = parts.filter((p) => p.botValidationStatus === "error").length;
    const stratN = strategiesCountByTeam[tm.id] || 0;
    const elo = eloByTeam[tm.id] ?? 1500;
    const wr = winRateOf(tm.id);
    const wrLabel = wr == null ? "—" : `${Math.round(wr * 100)}%`;

    let status, statusClass, warningMsg = "";
    if (koCount > 0) { status = t("teams.card.status.warning"); statusClass = "warn"; warningMsg = t("teams.card.warning.invalid_bot"); }
    else if (parts.length === 0) { status = t("teams.card.status.idle"); statusClass = ""; }
    else if (hasBotCount === 0) { status = t("teams.card.status.pending"); statusClass = "warn"; warningMsg = t("teams.card.warning.no_bot"); }
    else { status = t("teams.card.status.active"); statusClass = "ok"; }

    const card = document.createElement("article");
    card.className = "team-card-admin" + (tm.id === selectedTeamId ? " selected" : "");
    card.dataset.teamId = tm.id;

    card.innerHTML = `
      <div class="team-card-head">
        <span class="team-card-hex">${tm.emoji || "▣"}</span>
        <div class="team-card-headbody">
          <h4 class="team-card-name">${escapeHtml(tm.display_name)}</h4>
          ${tm.email ? `<p class="team-card-email muted small">${escapeHtml(tm.email)}</p>` : ""}
          <span class="badge ${statusClass}">${escapeHtml(status)}</span>
        </div>
        <button type="button" class="team-kebab" data-team-menu="${escapeHtml(tm.id)}" aria-label="${t("teams.kebab.menu")}">⋯</button>
      </div>

      ${warningMsg ? `<p class="team-card-warning">⚠ ${escapeHtml(warningMsg)}</p>` : ""}

      <div class="team-card-stats">
        <div><span class="team-card-stat-label">${escapeHtml(t("teams.card.stat.elo"))}</span><span class="team-card-stat-value">${elo}</span></div>
        <div><span class="team-card-stat-label">${escapeHtml(t("teams.card.stat.strategies"))}</span><span class="team-card-stat-value">${stratN}</span></div>
        <div><span class="team-card-stat-label">${escapeHtml(t("teams.card.stat.winrate"))}</span><span class="team-card-stat-value">${wrLabel}</span></div>
      </div>

      <p class="team-card-tournaments-line muted small">${escapeHtml(t("teams.card.tournaments_line", { n: parts.length }))}</p>
    `;

    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-team-del]")) return;
      selectTeam(tm.id);
    });
    els.grid.appendChild(card);
  }

  wireKebabs();
}

// Rows view : one horizontal line per team, same info as a card.
function renderRowsView(list) {
  const header = document.createElement("div");
  header.className = "team-row-admin team-row-header";
  header.innerHTML = `
    <span></span>
    <span>${escapeHtml(t("teams.row.col.team"))}</span>
    <span>${escapeHtml(t("teams.row.col.email"))}</span>
    <span>${escapeHtml(t("teams.row.col.status"))}</span>
    <span class="num">${escapeHtml(t("teams.card.stat.elo"))}</span>
    <span class="num">${escapeHtml(t("teams.card.stat.strategies"))}</span>
    <span class="num">${escapeHtml(t("teams.card.stat.winrate"))}</span>
    <span class="num">${escapeHtml(t("teams.card.stat.tournaments"))}</span>
    <span></span>
  `;
  els.grid.appendChild(header);

  for (const tm of list) {
    const parts = participationsByTeam[tm.id] || [];
    const hasBotCount = parts.filter((p) => !!p.botCode).length;
    const koCount = parts.filter((p) => p.botValidationStatus === "error").length;
    const stratN = strategiesCountByTeam[tm.id] || 0;
    const elo = eloByTeam[tm.id] ?? 1500;
    const wr = winRateOf(tm.id);
    const wrLabel = wr == null ? "—" : `${Math.round(wr * 100)}%`;

    let status, statusClass;
    if (koCount > 0) { status = t("teams.card.status.warning"); statusClass = "warn"; }
    else if (parts.length === 0) { status = t("teams.card.status.idle"); statusClass = ""; }
    else if (hasBotCount === 0) { status = t("teams.card.status.pending"); statusClass = "warn"; }
    else { status = t("teams.card.status.active"); statusClass = "ok"; }

    const row = document.createElement("div");
    row.className = "team-row-admin" + (tm.id === selectedTeamId ? " selected" : "");
    row.dataset.teamId = tm.id;
    row.innerHTML = `
      <span class="team-row-emoji">${tm.emoji || "▣"}</span>
      <span class="team-row-name">${escapeHtml(tm.display_name)}</span>
      <span class="team-row-email muted">${escapeHtml(tm.email || "—")}</span>
      <span><span class="badge ${statusClass}">${escapeHtml(status)}</span></span>
      <span class="num">${elo}</span>
      <span class="num">${stratN}</span>
      <span class="num">${wrLabel}</span>
      <span class="num">${parts.length}</span>
      <button type="button" class="team-kebab" data-team-menu="${escapeHtml(tm.id)}" aria-label="${t("teams.kebab.menu")}">⋯</button>
    `;
    row.addEventListener("click", (e) => {
      if (e.target.closest("[data-team-del]")) return;
      selectTeam(tm.id);
    });
    els.grid.appendChild(row);
  }

  wireKebabs();
}

function wireKebabs() {
  els.grid.querySelectorAll("[data-team-menu]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openKebabMenu(btn, btn.dataset.teamMenu);
    });
  });
}

let openMenuEl = null;

function openKebabMenu(anchorBtn, teamId) {
  closeKebabMenu();
  const tm = teams.find((t) => t.id === teamId);
  if (!tm) return;
  const menu = document.createElement("div");
  menu.className = "kebab-menu";
  menu.innerHTML = `
    <button type="button" data-menu-action="edit">✏️ <span>${escapeHtml(t("teams.action.edit"))}</span></button>
    <button type="button" data-menu-action="delete">🗑 <span>${escapeHtml(t("teams.action.delete"))}</span></button>
  `;
  document.body.appendChild(menu);
  // Position next to the kebab button.
  const rect = anchorBtn.getBoundingClientRect();
  const menuWidth = 170;
  const top = rect.bottom + 6;
  // Prefer right-aligned relative to the button; flip if off-screen.
  let left = rect.right - menuWidth;
  if (left < 8) left = rect.left;
  menu.style.top = `${top + window.scrollY}px`;
  menu.style.left = `${left}px`;

  menu.querySelector('[data-menu-action="edit"]').addEventListener("click", (e) => {
    e.stopPropagation();
    closeKebabMenu();
    openTeamModal(teamId);
  });
  menu.querySelector('[data-menu-action="delete"]').addEventListener("click", async (e) => {
    e.stopPropagation();
    closeKebabMenu();
    if (!confirm(t("teams.delete.confirm", { name: tm.display_name }))) return;
    try {
      await deleteDoc(doc(db, "teams", teamId));
      if (selectedTeamId === teamId) { selectedTeamId = null; setDetailVisible(false); }
      await refresh();
    } catch (err) {
      console.error(err);
      alert(t("teams.add.error", { msg: err.message || err }));
    }
  });

  openMenuEl = menu;
}

function closeKebabMenu() {
  if (openMenuEl && openMenuEl.parentNode) openMenuEl.parentNode.removeChild(openMenuEl);
  openMenuEl = null;
}

// Close the menu on outside click / Escape / scroll
document.addEventListener("click", (e) => {
  if (!openMenuEl) return;
  if (openMenuEl.contains(e.target)) return;
  closeKebabMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeKebabMenu();
});
window.addEventListener("scroll", closeKebabMenu, true);

// View toggle (cards / rows)
document.querySelectorAll(".view-toggle-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.mode;
    if (mode === viewMode) return;
    viewMode = mode;
    localStorage.setItem("axelrod.teams.view", mode);
    document.querySelectorAll(".view-toggle-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.mode === viewMode);
    });
    renderGrid();
  });
});
// Sync initial active state from persisted mode.
document.querySelectorAll(".view-toggle-btn").forEach((b) => {
  b.classList.toggle("active", b.dataset.mode === viewMode);
});

// ---------- Detail panel ----------
// Show / hide the side panel AND toggle the grid layout so the team list
// reclaims the full content width when no team is selected.
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
  els.detailUid.textContent = tm.email || t("teams.detail.no_email");

  const parts = participationsByTeam[teamId] || [];
  const stratN = strategiesCountByTeam[teamId] || 0;
  const elo = eloByTeam[teamId] ?? 1500;
  const wr = winRateOf(teamId);
  const wrLabel = wr == null ? "—" : `${Math.round(wr * 100)}%`;
  const created = tm.created_at?.toDate?.()?.toLocaleDateString(
    document.documentElement.lang === "fr" ? "fr-FR" : "en-GB"
  ) || "—";

  els.detailSummary.innerHTML = `
    <li><span>${escapeHtml(t("teams.detail.created"))}</span><span>${escapeHtml(created)}</span></li>
    <li><span>${escapeHtml(t("teams.detail.elo"))}</span><span>${elo}</span></li>
    <li><span>${escapeHtml(t("teams.detail.winrate"))}</span><span>${wrLabel}</span></li>
    <li><span>${escapeHtml(t("teams.detail.strategies"))}</span><span>${stratN}</span></li>
    <li><span>${escapeHtml(t("teams.detail.tournaments_count"))}</span><span>${parts.length}</span></li>
    <li><span>${escapeHtml(t("teams.detail.bots"))}</span><span>${parts.filter((p) => !!p.botCode).length}</span></li>
  `;

  if (parts.length === 0) {
    els.detailTournaments.innerHTML = `<li class="muted small">${escapeHtml(t("teams.detail.no_tournament"))}</li>`;
  } else {
    els.detailTournaments.innerHTML = parts.map((p) => {
      const statusLabel = t(`admin.status.${p.tournamentStatus || "open_submission"}`);
      const botBadge = p.botCode
        ? (p.botValidationStatus === "ok"
          ? `<span class="badge ok">${escapeHtml(t("tournament.bot.modal.status.valid"))}</span>`
          : `<span class="badge ko">${escapeHtml(t("tournament.bot.modal.status.invalid"))}</span>`)
        : `<span class="badge">${escapeHtml(t("teams.bot.none"))}</span>`;
      return `
        <li>
          <a href="tournament-view.html?t=${encodeURIComponent(p.tournamentId)}" class="detail-tournament-link">
            <span>${escapeHtml(p.tournamentName)}</span>
            <span class="muted small">${escapeHtml(statusLabel)}</span>
          </a>
          ${botBadge}
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

els.actionEdit.addEventListener("click", () => {
  if (!selectedTeamId) return;
  openTeamModal(selectedTeamId);
});

els.actionDelete.addEventListener("click", async () => {
  if (!selectedTeamId) return;
  const tm = teams.find((t) => t.id === selectedTeamId);
  if (!tm) return;
  if (!confirm(t("teams.delete.confirm", { name: tm.display_name }))) return;
  try {
    await deleteDoc(doc(db, "teams", selectedTeamId));
    selectedTeamId = null;
    setDetailVisible(false);
    await refresh();
  } catch (err) {
    console.error(err);
    alert(t("teams.add.error", { msg: err.message || err }));
  }
});

// ---------- Modal create/edit ----------
els.openCreateBtn.addEventListener("click", () => openTeamModal(null));

function openTeamModal(teamId) {
  editingTeamId = teamId;
  els.formMsg.hidden = true;
  if (teamId) {
    const tm = teams.find((t) => t.id === teamId);
    if (!tm) return;
    els.teamModalTitle.textContent = t("teams.modal.title.edit");
    els.submitBtn.textContent = t("teams.modal.submit.edit");
    els.inputName.value = tm.display_name || "";
    els.inputEmoji.value = tm.emoji || "";
    els.inputEmail.value = tm.email || "";
    els.inputUid.value = tm.id;
    els.inputUid.disabled = true;
  } else {
    els.teamModalTitle.textContent = t("teams.modal.title.create");
    els.submitBtn.textContent = t("teams.modal.submit.create");
    els.teamForm.reset();
    els.inputUid.disabled = false;
  }
  openModal(els.teamModal);
}

els.teamForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.formMsg.hidden = true;
  const display_name = els.inputName.value.trim();
  const emoji = els.inputEmoji.value.trim();
  const email = els.inputEmail.value.trim();
  const uid = els.inputUid.value.trim();
  if (!display_name || !uid) return;
  els.submitBtn.disabled = true;
  try {
    const ref = doc(db, "teams", uid);
    if (editingTeamId) {
      await updateDoc(ref, { display_name, emoji, email });
    } else {
      await setDoc(ref, { display_name, emoji, email, created_at: serverTimestamp() });
    }
    closeModal(els.teamModal);
    await refresh();
  } catch (err) {
    console.error(err);
    showMsg(els.formMsg, false, t("teams.add.error", { msg: err.message || err }));
  } finally {
    els.submitBtn.disabled = false;
  }
});

// ---------- Modal helpers ----------
function openModal(modal) {
  modal.hidden = false;
  modal.addEventListener("click", onModalBackdropClick);
}
function closeModal(modal) {
  modal.hidden = true;
  modal.removeEventListener("click", onModalBackdropClick);
}
function onModalBackdropClick(e) {
  if (e.target === e.currentTarget || e.target.dataset.modalClose !== undefined || e.target.classList.contains("modal-close")) {
    closeModal(e.currentTarget);
  }
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelectorAll(".modal-backdrop").forEach((m) => { if (!m.hidden) closeModal(m); });
  }
});

document.addEventListener("langchange", () => {
  if (!els.main.hidden) {
    renderStats();
    populateTournamentFilter();
    renderGrid();
    if (selectedTeamId) renderDetail(selectedTeamId);
  }
});

// ---------- Helpers ----------
function showMsg(el, ok, message) {
  el.hidden = false;
  el.classList.remove("ok", "ko");
  el.classList.add(ok ? "ok" : "ko");
  el.textContent = message;
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
