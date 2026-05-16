// Admin view of all duels. Read-only table with filters and per-team
// activity stats — gives the teacher a sense of which teams are actively
// sparring during the development phase.

import { onAuth, isUserAdmin } from "./auth.js";
import { initSidebar } from "./sidebar.js";
import { t } from "./i18n.js";
import { db } from "./firebase-config.js";
import {
  collection,
  onSnapshot,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

initSidebar("admin-duels");

const els = {
  main: document.getElementById("main"),
  accessDenied: document.getElementById("access-denied"),
  tabs: document.querySelectorAll(".duels-tabs .tab-btn"),
  body: document.getElementById("admin-duels-body"),
  empty: document.getElementById("admin-duels-empty"),
  stats: document.getElementById("admin-duels-stats"),
  detailModal: document.getElementById("duel-detail-modal"),
  detailBody: document.getElementById("duel-detail-body")
};

let allDuels = [];
let activeFilter = "all";

onAuth(async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  const admin = await isUserAdmin(user.uid);
  if (!admin) {
    els.accessDenied.hidden = false;
    return;
  }
  els.main.hidden = false;

  const q = query(collection(db, "duels"), orderBy("created_at", "desc"));
  onSnapshot(q, (snap) => {
    allDuels = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  });
});

els.tabs.forEach((btn) => {
  btn.addEventListener("click", () => {
    activeFilter = btn.dataset.filter;
    els.tabs.forEach((b) => b.classList.toggle("active", b === btn));
    render();
  });
});

function passesFilter(d) {
  if (activeFilter === "all") return true;
  if (activeFilter === "pending") return ["pending", "accepted", "running"].includes(d.status);
  if (activeFilter === "completed") return d.status === "completed";
  if (activeFilter === "declined") return d.status === "declined" || d.status === "error";
  return true;
}

function render() {
  const rows = allDuels.filter(passesFilter);
  renderStats(allDuels);

  if (rows.length === 0) {
    els.body.innerHTML = "";
    els.empty.hidden = false;
    return;
  }
  els.empty.hidden = true;
  els.body.innerHTML = rows.map(rowHtml).join("");
  // Wire click-to-open on each row. Re-attach every render since innerHTML
  // replacement nukes previous listeners.
  els.body.querySelectorAll("tr[data-duel-id]").forEach((tr) => {
    tr.addEventListener("click", () => {
      const id = tr.dataset.duelId;
      const duel = allDuels.find((d) => d.id === id);
      if (duel) openDetailModal(duel);
    });
  });
}

function renderStats(duels) {
  if (duels.length === 0) {
    els.stats.innerHTML = "";
    return;
  }
  const byStatus = { pending: 0, accepted: 0, running: 0, completed: 0, declined: 0, error: 0 };
  const byTeam = new Map();
  for (const d of duels) {
    byStatus[d.status] = (byStatus[d.status] || 0) + 1;
    if (d.inviter_team_name) byTeam.set(d.inviter_team_name, (byTeam.get(d.inviter_team_name) || 0) + 1);
    if (d.invitee_team_name) byTeam.set(d.invitee_team_name, (byTeam.get(d.invitee_team_name) || 0) + 1);
  }
  const mostActive = [...byTeam.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  els.stats.innerHTML = `
    <div class="summary-stat">
      <span class="summary-stat-label">${t("admin.duels.stat.total")}</span>
      <span class="summary-stat-value">${duels.length}</span>
    </div>
    <div class="summary-stat">
      <span class="summary-stat-label">${t("admin.duels.stat.completed")}</span>
      <span class="summary-stat-value">${byStatus.completed || 0}</span>
    </div>
    <div class="summary-stat">
      <span class="summary-stat-label">${t("admin.duels.stat.pending")}</span>
      <span class="summary-stat-value">${(byStatus.pending || 0) + (byStatus.accepted || 0) + (byStatus.running || 0)}</span>
    </div>
    <div class="summary-stat">
      <span class="summary-stat-label">${t("admin.duels.stat.most_active")}</span>
      <span class="summary-stat-value summary-stat-list">
        ${mostActive.map(([name, n]) => `${escapeHtml(name)} <span class="muted">(${n})</span>`).join(" · ") || "—"}
      </span>
    </div>
  `;
}

function rowHtml(d) {
  const status = d.status;
  const statusLabel = t(`duels.status.${status}`);
  const r = d.result || {};
  let resultCell = "—";
  if (status === "completed" && r.score_a !== undefined) {
    const winner = r.score_a > r.score_b
      ? d.inviter_team_name
      : r.score_b > r.score_a
        ? d.invitee_team_name
        : "—";
    resultCell = `${r.score_a} <span class="muted">vs</span> ${r.score_b} · <strong>${escapeHtml(winner || "tie")}</strong>`;
  } else if (status === "error") {
    resultCell = `<span class="ko" title="${escapeAttr(d.error || "")}">error</span>`;
  }
  return `
    <tr data-duel-id="${escapeAttr(d.id)}" class="admin-duel-row">
      <td class="muted small">${formatTs(d.created_at)}</td>
      <td>${escapeHtml(d.inviter_team_name || "?")}</td>
      <td>${escapeHtml(d.invitee_team_name || "?")}</td>
      <td class="small">
        ${escapeHtml(d.inviter_strategy_name || "?")} <span class="muted">⚔</span>
        ${escapeHtml(d.invitee_strategy_name || "—")}
      </td>
      <td class="muted small">${d.nb_turns}t · ${Math.round((d.noise_level || 0) * 100)}%</td>
      <td><span class="duel-status duel-status-${status}">${escapeHtml(statusLabel)}</span></td>
      <td>${resultCell}</td>
    </tr>
  `;
}

// ---------- Detail modal ----------
function openDetailModal(d) {
  const r = d.result || {};
  const hasResult = d.status === "completed" && r.score_a !== undefined;
  const winner =
    !hasResult ? null
    : r.score_a > r.score_b ? "a"
    : r.score_b > r.score_a ? "b"
    : "tie";

  const resultBlock = hasResult ? `
    <div class="admin-duel-result">
      <div class="admin-duel-result-scores">
        <div class="${winner === "a" ? "winner" : ""}">
          <div class="muted small">${escapeHtml(d.inviter_team_name)}</div>
          <div class="score">${r.score_a}</div>
        </div>
        <div class="muted small">vs</div>
        <div class="${winner === "b" ? "winner" : ""}">
          <div class="muted small">${escapeHtml(d.invitee_team_name)}</div>
          <div class="score">${r.score_b}</div>
        </div>
      </div>
      <div class="admin-duel-histories">
        <div class="match-row">
          <span class="match-row-label">${escapeHtml(d.inviter_team_name)}</span>
          <div class="match-cells">${renderCells(r.history_a || "")}</div>
        </div>
        <div class="match-row">
          <span class="match-row-label">${escapeHtml(d.invitee_team_name)}</span>
          <div class="match-cells">${renderCells(r.history_b || "")}</div>
        </div>
      </div>
    </div>
  ` : d.status === "error" ? `
    <p class="error">${escapeHtml(d.error || "Match failed")}</p>
  ` : d.status === "declined" ? `
    <p class="muted">${escapeHtml(t("duels.detail.declined"))}</p>
  ` : `
    <p class="muted small">${escapeHtml(t("admin.duels.detail.no_result_yet"))}</p>
  `;

  els.detailBody.innerHTML = `
    <div class="admin-duel-meta">
      <div><span class="muted small">${escapeHtml(t("admin.duels.col.date"))} :</span> ${formatTs(d.created_at)}</div>
      <div><span class="muted small">${escapeHtml(t("admin.duels.col.params"))} :</span> ${d.nb_turns} ${escapeHtml(t("playground.match.tours"))} · ${Math.round((d.noise_level || 0) * 100)}% ${escapeHtml(t("playground.noise.label").toLowerCase())}</div>
      <div><span class="muted small">${escapeHtml(t("admin.duels.col.status"))} :</span> <span class="duel-status duel-status-${d.status}">${escapeHtml(t(`duels.status.${d.status}`))}</span></div>
    </div>

    ${resultBlock}

    <h3 class="admin-duel-code-heading">${escapeHtml(t("admin.duels.detail.code"))}</h3>
    <div class="admin-duel-codes">
      <div class="admin-duel-code-block">
        <div class="admin-duel-code-head">
          <strong>${escapeHtml(d.inviter_team_name || "?")}</strong>
          <span class="muted small">${escapeHtml(d.inviter_strategy_name || t("admin.duels.detail.no_strategy"))}</span>
        </div>
        <pre class="admin-duel-code">${escapeHtml(d.inviter_strategy_code || "")}</pre>
      </div>
      <div class="admin-duel-code-block">
        <div class="admin-duel-code-head">
          <strong>${escapeHtml(d.invitee_team_name || "?")}</strong>
          <span class="muted small">${escapeHtml(d.invitee_strategy_name || t("admin.duels.detail.no_strategy"))}</span>
        </div>
        <pre class="admin-duel-code">${escapeHtml(d.invitee_strategy_code || "")}</pre>
      </div>
    </div>
  `;
  openModal(els.detailModal);
}

function renderCells(str) {
  let out = "";
  for (const c of str) {
    out += `<span class="cell ${c === "C" ? "c" : "d"}">${c}</span>`;
  }
  return out;
}

// ---------- Modal helpers ----------
function openModal(modal) {
  modal.hidden = false;
  modal.addEventListener("click", onBackdropClick);
}
function closeModal(modal) {
  modal.hidden = true;
  modal.removeEventListener("click", onBackdropClick);
}
function onBackdropClick(e) {
  if (e.target === e.currentTarget || e.target.dataset.modalClose !== undefined || e.target.classList.contains("modal-close")) {
    closeModal(e.currentTarget);
  }
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelectorAll(".modal-backdrop").forEach((m) => {
      if (!m.hidden) closeModal(m);
    });
  }
});

function formatTs(ts) {
  const ms = ts?.toMillis?.() ?? 0;
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function escapeAttr(s) {
  return String(s).replace(/"/g, "&quot;");
}
