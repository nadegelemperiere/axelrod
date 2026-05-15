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
  stats: document.getElementById("admin-duels-stats")
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
    <tr>
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
