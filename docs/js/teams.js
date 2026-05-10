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
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

initSidebar("admin-teams");

const els = {
  accessDenied: document.getElementById("access-denied"),
  main: document.getElementById("main"),
  addForm: document.getElementById("add-form"),
  addMsg: document.getElementById("add-msg"),
  teamsList: document.getElementById("teams-list"),
  inputName: document.getElementById("t-name"),
  inputEmoji: document.getElementById("t-emoji"),
  inputUid: document.getElementById("t-uid")
};

let tournaments = [];

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
  await loadTournaments();
  await refreshTeams();
});

async function loadTournaments() {
  const q = query(collection(db, "tournaments"), orderBy("created_at", "desc"));
  const snap = await getDocs(q);
  tournaments = [];
  snap.forEach((d) => tournaments.push({ id: d.id, ...d.data() }));
}

els.addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.addMsg.hidden = true;
  const display_name = els.inputName.value.trim();
  const emoji = els.inputEmoji.value.trim();
  const uid_owner = els.inputUid.value.trim();
  if (!display_name || !uid_owner) return;

  try {
    const teamRef = doc(db, "teams", uid_owner);
    const existing = await getDoc(teamRef);
    if (existing.exists()) {
      await updateDoc(teamRef, { display_name, emoji });
    } else {
      await setDoc(teamRef, {
        display_name,
        emoji,
        active_tournament_id: null,
        created_at: serverTimestamp()
      });
    }
    showMsg(els.addMsg, true, t("teams.add.success", { name: display_name }));
    els.addForm.reset();
    await refreshTeams();
  } catch (err) {
    console.error(err);
    showMsg(els.addMsg, false, t("teams.add.error", { msg: err.message || err }));
  }
});

async function refreshTeams() {
  const teamsRef = collection(db, "teams");
  const snap = await getDocs(teamsRef);
  els.teamsList.innerHTML = "";
  if (snap.empty) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = t("teams.list.empty");
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

  // Count strategies per team (1 query per team — fine for ~10 teams).
  const stratCounts = {};
  await Promise.all(
    teams.map(async (team) => {
      const stratSnap = await getDocs(collection(db, "teams", team.id, "strategies"));
      stratCounts[team.id] = stratSnap.size;
    })
  );

  teams.forEach((team) => {
    const hue = teamHue(team.display_name);
    const li = document.createElement("li");
    li.className = "team-row";
    li.style.setProperty("--team-color", `hsl(${hue} 75% 65%)`);
    const avatarUrl = `https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${encodeURIComponent(team.display_name)}&backgroundColor=transparent`;
    const emoji = team.emoji ? `<span class="team-emoji">${escapeHtml(team.emoji)}</span>` : "";
    const stratN = stratCounts[team.id] || 0;
    const stratLabel = stratN > 1
      ? t("teams.admin.strategies.count.plural", { n: stratN })
      : t("teams.admin.strategies.count", { n: stratN });

    const tournamentName = team.active_tournament_id
      ? (tournaments.find((tn) => tn.id === team.active_tournament_id)?.name || team.active_tournament_id)
      : t("teams.admin.tournament.none");

    li.innerHTML = `
      <div class="t-row" style="gap: 0.85rem;">
        <div class="team-avatar-mini" style="border-color: hsl(${hue} 75% 65%);">
          <img src="${avatarUrl}" alt="" loading="lazy" />
        </div>
        <input type="text" class="inline-edit emoji-edit" data-id="${team.id}" data-field="emoji" value="${escapeHtml(team.emoji || "")}" maxlength="4" placeholder="🍑" />
        <input type="text" class="inline-edit name-edit" data-id="${team.id}" data-field="display_name" value="${escapeHtml(team.display_name || "")}" maxlength="40" />
        <span class="badge">${escapeHtml(stratLabel)}</span>
        <span class="meta">${escapeHtml(t("teams.admin.tournament.column"))}: <strong>${escapeHtml(tournamentName)}</strong></span>
        <button data-id="${team.id}" data-name="${escapeHtml(team.display_name)}" class="del-btn" type="button">${t("admin.delete")}</button>
      </div>
    `;
    els.teamsList.appendChild(li);
  });

  // Wire inline edits (name + emoji)
  els.teamsList.querySelectorAll(".inline-edit").forEach((input) => {
    const original = input.value;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); input.blur(); }
      if (e.key === "Escape") { input.value = original; input.blur(); }
    });
    input.addEventListener("blur", async () => {
      const newVal = input.value.trim();
      const field = input.dataset.field;
      const id = input.dataset.id;
      // For display_name, don't accept empty
      if (field === "display_name" && !newVal) {
        input.value = original;
        return;
      }
      if (newVal === original) return;
      try {
        await updateDoc(doc(db, "teams", id), { [field]: newVal });
        // Avatar depends on display_name → re-render that row
        await refreshTeams();
      } catch (err) {
        console.error(err);
        alert(t("teams.add.error", { msg: err.message || err }));
        input.value = original;
      }
    });
  });

  els.teamsList.querySelectorAll(".del-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("strategies.delete.confirm"))) return;
      try {
        // Delete strategies subcollection first (admin can read/delete? not via current rules)
        // Rules currently only let team owner manage their strategies. Admin deletes the team doc;
        // the strategies subcollection becomes orphaned. Acceptable for now.
        await deleteDoc(doc(db, "teams", btn.dataset.id));
        await refreshTeams();
      } catch (err) {
        console.error(err);
        alert(t("teams.add.error", { msg: err.message || err }));
      }
    });
  });
}

document.addEventListener("langchange", () => {
  if (!els.main.hidden) refreshTeams();
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
