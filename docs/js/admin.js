import { onAuth, isUserAdmin } from "./auth.js";
import { initSidebar } from "./sidebar.js";
import { t } from "./i18n.js";
import { db } from "./firebase-config.js";
import {
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
  doc,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

initSidebar("admin-tournaments");

const els = {
  main: document.getElementById("main"),
  accessDenied: document.getElementById("access-denied"),
  tList: document.getElementById("t-list"),
  openCreateBtn: document.getElementById("open-create-btn"),
  createModal: document.getElementById("create-modal"),
  createForm: document.getElementById("create-form"),
  tabs: document.querySelectorAll(".tournament-tabs .tab-btn")
};

// "active" groups open_submission + running. "completed" is its own thing.
const FILTER_TO_STATUSES = {
  all: ["open_submission", "running", "completed"],
  active: ["open_submission", "running"],
  completed: ["completed"]
};

let allTournaments = [];   // raw list, refreshed from Firestore
let teamCountByTid = {};   // tid → number of registered teams
let currentFilter = "all";

onAuth(async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  const admin = await isUserAdmin(user.uid);
  if (!admin) {
    els.main.hidden = true;
    els.accessDenied.hidden = false;
    return;
  }
  els.main.hidden = false;
  await refreshTournaments();
});

// ---------- Tabs ----------
els.tabs.forEach((btn) => {
  btn.addEventListener("click", () => {
    currentFilter = btn.dataset.filter;
    els.tabs.forEach((b) => b.classList.toggle("active", b === btn));
    renderList();
  });
});

// ---------- Create modal ----------
els.openCreateBtn.addEventListener("click", () => openModal(els.createModal));

els.createForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("t-name").value.trim();
  const nbTurns = parseInt(document.getElementById("t-turns").value, 10);
  const noiseLevel = parseFloat(document.getElementById("t-noise").value);
  await addDoc(collection(db, "tournaments"), {
    name,
    nb_turns: nbTurns,
    noise_level: noiseLevel,
    phase: 1,
    status: "open_submission",
    created_at: serverTimestamp(),
    updated_at: serverTimestamp()
  });
  els.createForm.reset();
  document.getElementById("t-turns").value = 30;
  document.getElementById("t-noise").value = 0;
  closeModal(els.createModal);
  await refreshTournaments();
});

// ---------- Data ----------
async function refreshTournaments() {
  const q = query(collection(db, "tournaments"), orderBy("created_at", "desc"));
  const snap = await getDocs(q);
  allTournaments = [];
  snap.forEach((d) => allTournaments.push({ id: d.id, ...d.data() }));

  // Count teams per tournament — one query per tournament (cheap for ~10 tournois).
  const counts = await Promise.all(
    allTournaments.map(async (tt) => {
      const partsSnap = await getDocs(collection(db, "tournaments", tt.id, "teams"));
      return [tt.id, partsSnap.size];
    })
  );
  teamCountByTid = Object.fromEntries(counts);

  renderList();
}

// ---------- Rendering ----------
function renderList() {
  els.tList.innerHTML = "";
  const allowedStatuses = FILTER_TO_STATUSES[currentFilter] || FILTER_TO_STATUSES.all;
  const filtered = allTournaments.filter((tt) =>
    allowedStatuses.includes(tt.status || "open_submission")
  );

  if (filtered.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = t("admin.list.empty");
    els.tList.appendChild(li);
    return;
  }

  for (const tt of filtered) {
    const status = tt.status || "open_submission";
    const badgeClass = status === "running"
      ? "live"
      : status === "completed" ? "ok" : "warn";
    const statusLabel = t(`admin.status.${status}`);
    const teamCount = teamCountByTid[tt.id] || 0;
    const teamCountLabel = teamCount === 1
      ? t("tournaments.list.teams_count.one", { n: teamCount })
      : t("tournaments.list.teams_count", { n: teamCount });
    const meta = t("admin.tournament.meta", {
      phase: tt.phase,
      turns: tt.nb_turns,
      noise: (tt.noise_level * 100).toFixed(0)
    });
    const dateInfo = formatDateInfo(tt);
    const hue = hashHue(tt.id);
    const isCompleted = status === "completed";
    const actionLabel = isCompleted ? t("admin.card.results") : t("admin.card.manage");
    // Completed tournaments → analysis page. Anything else → management page.
    const actionHref = isCompleted
      ? `tournament-view.html?t=${encodeURIComponent(tt.id)}`
      : `tournament.html?t=${encodeURIComponent(tt.id)}`;

    const li = document.createElement("li");
    li.className = "tournament-admin-card";
    li.innerHTML = `
      <span class="tournament-admin-hex" style="--team-color: hsl(${hue} 75% 60%)">${hexIconSvg(hue)}</span>
      <div class="tournament-admin-body">
        <div class="tournament-admin-title-row">
          <h3 class="tournament-admin-name">${escapeHtml(tt.name)}</h3>
          <span class="badge ${badgeClass}">${escapeHtml(statusLabel)}</span>
        </div>
        <div class="tournament-admin-meta">
          <span>${escapeHtml(teamCountLabel)}</span>
          <span>${escapeHtml(meta)}</span>
        </div>
        ${dateInfo ? `<div class="tournament-admin-date">${escapeHtml(dateInfo)}</div>` : ""}
      </div>
      <div class="tournament-admin-actions">
        <a href="${actionHref}" class="tournament-admin-action">${escapeHtml(actionLabel)}</a>
        <button type="button" data-del="${tt.id}" data-name="${escapeHtml(tt.name)}" class="tournament-admin-delete" title="${t("admin.delete")}" aria-label="${t("admin.delete")}">×</button>
      </div>
    `;
    els.tList.appendChild(li);
  }

  els.tList.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("admin.delete.confirm.named", { name: btn.dataset.name }))) return;
      await deleteDoc(doc(db, "tournaments", btn.dataset.del));
      await refreshTournaments();
    });
  });
}

function formatDateInfo(tt) {
  const status = tt.status || "open_submission";
  const locale = document.documentElement.lang === "fr" ? "fr-FR" : "en-GB";
  if (status === "completed" && tt.completed_at?.toDate) {
    return t("admin.card.completed_at", { date: tt.completed_at.toDate().toLocaleDateString(locale) });
  }
  if (status === "running" && tt.launched_at?.toDate) {
    return t("admin.card.launched_at", { date: tt.launched_at.toDate().toLocaleDateString(locale) });
  }
  if (tt.created_at?.toDate) {
    return t("admin.card.created_at", { date: tt.created_at.toDate().toLocaleDateString(locale) });
  }
  return null;
}

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
    document.querySelectorAll(".modal-backdrop").forEach((m) => {
      if (!m.hidden) closeModal(m);
    });
  }
});

document.addEventListener("langchange", () => {
  if (!els.main.hidden) renderList();
});

// ---------- Helpers ----------
function hashHue(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = s.charCodeAt(i) + ((h << 5) - h);
    h |= 0;
  }
  return Math.abs(h) % 360;
}

function hexIconSvg(hue) {
  const color = `hsl(${hue} 75% 60%)`;
  return `<svg viewBox="0 0 64 64" width="64" height="64" xmlns="http://www.w3.org/2000/svg">
    <polygon points="32,4 56,18 56,46 32,60 8,46 8,18" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="1.5"/>
    <polygon points="32,16 44,23 44,37 32,44 20,37 20,23" fill="${color}" fill-opacity="0.45"/>
  </svg>`;
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
