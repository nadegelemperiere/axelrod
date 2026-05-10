import { onAuth, isUserAdmin } from "./auth.js";
import { initSidebar } from "./sidebar.js";
import { t } from "./i18n.js";
import { db } from "./firebase-config.js";
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  getDocs,
  query,
  where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

initSidebar("admin-tournaments");

const els = {
  accessDenied: document.getElementById("access-denied"),
  main: document.getElementById("main"),
  tTitle: document.getElementById("t-title"),
  tMeta: document.getElementById("t-meta"),
  addForm: document.getElementById("add-form"),
  addBtn: document.getElementById("add-btn"),
  addMsg: document.getElementById("add-msg"),
  addEmptyHint: document.getElementById("add-empty-hint"),
  pick: document.getElementById("t-pick"),
  teamsList: document.getElementById("teams-list")
};

const params = new URLSearchParams(window.location.search);
const tournamentId = params.get("t");

if (!tournamentId) {
  alert(t("teams.alert.no.tid"));
  window.location.href = "admin.html";
}

let tournamentData = null;

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
  const tSnap = await getDoc(doc(db, "tournaments", tournamentId));
  if (!tSnap.exists()) {
    alert(t("teams.alert.not.found"));
    window.location.href = "admin.html";
    return;
  }
  tournamentData = tSnap.data();
  renderHeader();
  els.main.hidden = false;
  await Promise.all([refreshAvailable(), refreshTeams()]);
});

function renderHeader() {
  if (!tournamentData) return;
  els.tTitle.textContent = tournamentData.name;
  els.tMeta.textContent = t("tournament.meta", {
    phase: tournamentData.phase,
    turns: tournamentData.nb_turns,
    noise: (tournamentData.noise_level * 100).toFixed(0),
    status: t(`admin.status.${tournamentData.status}`)
  });
}

async function refreshAvailable() {
  // Teams not yet in any tournament (active_tournament_id == null OR missing)
  const teamsRef = collection(db, "teams");
  const snap = await getDocs(teamsRef);
  const available = [];
  snap.forEach((d) => {
    const data = d.data();
    if (!data.active_tournament_id) {
      available.push({ id: d.id, ...data });
    }
  });
  available.sort((a, b) => (a.display_name || "").localeCompare(b.display_name || ""));

  els.pick.innerHTML = "";
  if (available.length === 0) {
    els.pick.disabled = true;
    els.addBtn.disabled = true;
    els.addEmptyHint.hidden = false;
    return;
  }
  els.pick.disabled = false;
  els.addBtn.disabled = false;
  els.addEmptyHint.hidden = true;
  for (const team of available) {
    const opt = document.createElement("option");
    opt.value = team.id;
    opt.textContent = `${team.emoji ? team.emoji + " " : ""}${team.display_name}`;
    els.pick.appendChild(opt);
  }
}

els.addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.addMsg.hidden = true;
  const teamId = els.pick.value;
  if (!teamId) return;
  els.addBtn.disabled = true;
  try {
    await updateDoc(doc(db, "teams", teamId), {
      active_tournament_id: tournamentId
    });
    showMsg(els.addMsg, true, t("teams.add.success", { name: els.pick.options[els.pick.selectedIndex].textContent.trim() }));
    await Promise.all([refreshAvailable(), refreshTeams()]);
  } catch (err) {
    console.error(err);
    showMsg(els.addMsg, false, t("teams.add.error", { msg: err.message || err }));
  } finally {
    els.addBtn.disabled = false;
  }
});

async function refreshTeams() {
  const teamsRef = collection(db, "teams");
  const q = query(teamsRef, where("active_tournament_id", "==", tournamentId));
  const snap = await getDocs(q);
  els.teamsList.innerHTML = "";
  if (snap.empty) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = t("tournament.teams.empty");
    els.teamsList.appendChild(li);
    return;
  }

  const teams = [];
  snap.forEach((d) => teams.push({ id: d.id, ...d.data() }));
  teams.sort((a, b) => {
    const at = a.created_at?.toMillis?.() ?? 0;
    const bt = b.created_at?.toMillis?.() ?? 0;
    return at - bt;
  });

  // Count this tournament's bots per team
  const botsSnap = await getDocs(collection(db, "tournaments", tournamentId, "bots"));
  const counts = {};
  botsSnap.forEach((b) => {
    const data = b.data();
    const tid = data.team_id;
    if (!tid) return;
    if (!counts[tid]) counts[tid] = { total: 0, valid: 0 };
    counts[tid].total += 1;
    if (data.validation_status === "ok") counts[tid].valid += 1;
  });

  teams.forEach((team) => {
    const c = counts[team.id] || { total: 0, valid: 0 };
    const hue = teamHue(team.display_name);
    const li = document.createElement("li");
    li.className = "team-row";
    li.style.setProperty("--team-color", `hsl(${hue} 75% 65%)`);
    const avatarUrl = `https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${encodeURIComponent(team.display_name)}&backgroundColor=transparent`;
    const emoji = team.emoji ? `<span class="team-emoji">${escapeHtml(team.emoji)}</span>` : "";
    const botInfo = c.total === 0
      ? `<span class="badge">${t("teams.bot.none")}</span>`
      : `<span class="badge ${c.valid > 0 ? "ok" : "ko"}">${t("teams.bot.count", { valid: c.valid, total: c.total })}</span>`;
    li.innerHTML = `
      <div class="t-row">
        <div class="team-avatar-mini" style="border-color: hsl(${hue} 75% 65%);">
          <img src="${avatarUrl}" alt="" loading="lazy" />
        </div>
        ${emoji}<strong>${escapeHtml(team.display_name)}</strong>
        ${botInfo}
        <button data-id="${team.id}" class="del-btn" type="button">${t("tournament.remove")}</button>
      </div>
    `;
    els.teamsList.appendChild(li);
  });

  els.teamsList.querySelectorAll(".del-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("tournament.remove.confirm"))) return;
      try {
        await updateDoc(doc(db, "teams", btn.dataset.id), { active_tournament_id: null });
        await Promise.all([refreshAvailable(), refreshTeams()]);
      } catch (err) {
        console.error(err);
        alert(t("teams.add.error", { msg: err.message || err }));
      }
    });
  });
}

document.addEventListener("langchange", () => {
  if (!els.main.hidden) {
    renderHeader();
    refreshAvailable();
    refreshTeams();
  }
});

function showMsg(el, ok, message) {
  el.hidden = false;
  el.classList.remove("ok", "ko");
  el.classList.add(ok ? "ok" : "ko");
  el.textContent = message;
}

function teamHue(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  return Math.abs(hash) % 360;
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
