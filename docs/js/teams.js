import { onAuth, logout, isUserAdmin } from "./auth.js";
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

const els = {
  userEmail: document.getElementById("user-email"),
  logoutBtn: document.getElementById("logout-btn"),
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
  alert("Paramètre 't' (tournament id) manquant dans l'URL.");
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
  els.userEmail.textContent = user.email;

  const tSnap = await getDoc(doc(db, "tournaments", tournamentId));
  if (!tSnap.exists()) {
    alert("Tournoi introuvable.");
    window.location.href = "admin.html";
    return;
  }
  const t = tSnap.data();
  els.tTitle.textContent = t.name;
  els.tMeta.textContent = `phase ${t.phase} · ${t.nb_turns} tours · bruit ${(t.noise_level * 100).toFixed(0)}% · statut ${t.status}`;
  els.main.hidden = false;
  await refreshTeams();
});

els.logoutBtn.addEventListener("click", async () => {
  await logout();
  window.location.href = "index.html";
});

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
      showMsg(els.addMsg, false, `Cet UID est déjà assigné à l'équipe ${existingData.team_id} du tournoi ${existingData.tournament_id}.`);
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

    showMsg(els.addMsg, true, `Équipe "${display_name}" ajoutée.`);
    els.addForm.reset();
    await refreshTeams();
  } catch (err) {
    console.error(err);
    showMsg(els.addMsg, false, `Erreur: ${err.message || err}`);
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
    li.textContent = "Aucune équipe pour ce tournoi.";
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
    const li = document.createElement("li");
    const emoji = team.emoji ? `<span class="team-emoji">${escapeHtml(team.emoji)}</span>` : "";
    const botInfo = c.total === 0
      ? '<span class="badge">aucun bot</span>'
      : `<span class="badge ${c.valid > 0 ? "ok" : "ko"}">${c.valid}/${c.total} valide${c.valid > 1 ? "s" : ""}</span>`;
    li.innerHTML = `
      <div class="t-row">
        ${emoji}<strong>${escapeHtml(team.display_name)}</strong>
        ${botInfo}
        <span class="meta uid">UID: ${escapeHtml(team.uid_owner)}</span>
        <button data-id="${team.id}" data-uid="${escapeHtml(team.uid_owner)}" class="del-btn" type="button">Supprimer</button>
      </div>
    `;
    els.teamsList.appendChild(li);
  });

  els.teamsList.querySelectorAll(".del-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Supprimer cette équipe ? Les bots soumis seront orphelins (cleanup automatique en Sprint 3).")) return;
      const teamId = btn.dataset.id;
      const uid = btn.dataset.uid;
      await deleteDoc(doc(db, "tournaments", tournamentId, "teams", teamId));
      await deleteDoc(doc(db, "users", uid));
      await refreshTeams();
    });
  });
}

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
