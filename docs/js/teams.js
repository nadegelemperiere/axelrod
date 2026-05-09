import { onAuth, isUserAdmin } from "./auth.js";
import { initSidebar } from "./sidebar.js";
import { t } from "./i18n.js";
import { db } from "./firebase-config.js";
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

initSidebar("admin-tournaments");

const els = {
  accessDenied: document.getElementById("access-denied"),
  main: document.getElementById("main"),
  tTitle: document.getElementById("t-title"),
  tMeta: document.getElementById("t-meta"),
  addForm: document.getElementById("add-form"),
  addMsg: document.getElementById("add-msg"),
  teamsList: document.getElementById("teams-list"),
  inputName: document.getElementById("t-name"),
  inputEmoji: document.getElementById("t-emoji"),
  inputUid: document.getElementById("t-uid")
};

const params = new URLSearchParams(window.location.search);
const tournamentId = params.get("t");

if (!tournamentId) {
  alert(t("teams.alert.no.tid"));
  window.location.href = "admin.html";
}

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
  renderTournamentHeader();
  els.main.hidden = false;
  await refreshTeams();
});

let tournamentData = null;

function renderTournamentHeader() {
  if (!tournamentData) return;
  els.tTitle.textContent = tournamentData.name;
  els.tMeta.textContent = t("teams.meta", {
    phase: tournamentData.phase,
    turns: tournamentData.nb_turns,
    noise: (tournamentData.noise_level * 100).toFixed(0),
    status: t(`admin.status.${tournamentData.status}`)
  });
}

els.addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.addMsg.hidden = true;
  const display_name = els.inputName.value.trim();
  const emoji = els.inputEmoji.value.trim();
  const uid_owner = els.inputUid.value.trim();
  if (!display_name || !uid_owner) return;

  try {
    // Vérifier que l'UID n'est pas déjà assigné
    const existing = await getDoc(doc(db, "users", uid_owner));
    if (existing.exists()) {
      const existingData = existing.data();
      showMsg(els.addMsg, false, t("teams.add.uid.exists", {
        team: existingData.team_id,
        tournament: existingData.tournament_id
      }));
      return;
    }

    // 1. Créer l'équipe (Firestore génère un teamId)
    const teamRef = await addDoc(collection(db, "tournaments", tournamentId, "teams"), {
      display_name,
      emoji,
      uid_owner,
      bot_status: "none",
      latest_bot_id: null,
      created_at: serverTimestamp()
    });

    // 2. Créer le mapping user → team
    await setDoc(doc(db, "users", uid_owner), {
      tournament_id: tournamentId,
      team_id: teamRef.id,
      assigned_at: serverTimestamp()
    });

    showMsg(els.addMsg, true, t("teams.add.success", { name: display_name }));
    els.addForm.reset();
    await refreshTeams();
  } catch (err) {
    console.error(err);
    showMsg(els.addMsg, false, t("teams.add.error", { msg: err.message || err }));
  }
});

async function refreshTeams() {
  const ref = collection(db, "tournaments", tournamentId, "teams");
  const q = query(ref, orderBy("created_at", "asc"));
  const snap = await getDocs(q);
  els.teamsList.innerHTML = "";
  if (snap.empty) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = t("teams.list.empty");
    els.teamsList.appendChild(li);
    return;
  }

  // pour chaque équipe, on compte aussi les bots soumis
  const teams = [];
  snap.forEach((d) => teams.push({ id: d.id, ...d.data() }));

  const counts = await Promise.all(
    teams.map(async (team) => {
      const botsSnap = await getDocs(collection(db, "tournaments", tournamentId, "teams", team.id, "bots"));
      let valid = 0;
      botsSnap.forEach((b) => {
        if (b.data().validation_status === "ok") valid++;
      });
      return { total: botsSnap.size, valid };
    })
  );

  teams.forEach((team, i) => {
    const c = counts[i];
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
        <span class="meta uid">${escapeHtml(team.uid_owner)}</span>
        <button data-id="${team.id}" data-uid="${escapeHtml(team.uid_owner)}" class="del-btn" type="button">${t("admin.delete")}</button>
      </div>
    `;
    els.teamsList.appendChild(li);
  });

  els.teamsList.querySelectorAll(".del-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("teams.delete.confirm"))) return;
      const teamId = btn.dataset.id;
      const uid = btn.dataset.uid;
      await deleteDoc(doc(db, "tournaments", tournamentId, "teams", teamId));
      await deleteDoc(doc(db, "users", uid));
      await refreshTeams();
    });
  });
}

document.addEventListener("langchange", () => {
  if (!els.main.hidden) {
    renderTournamentHeader();
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
