import { onAuth, logout, isUserAdmin } from "./auth.js";
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

const userEmailEl = document.getElementById("user-email");
const logoutBtn = document.getElementById("logout-btn");
const createForm = document.getElementById("create-form");
const tList = document.getElementById("t-list");
const main = document.getElementById("main");
const accessDenied = document.getElementById("access-denied");

onAuth(async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  const admin = await isUserAdmin(user.uid);
  if (!admin) {
    main.hidden = true;
    accessDenied.hidden = false;
    return;
  }
  userEmailEl.textContent = user.email;
  main.hidden = false;
  await refreshTournaments();
});

logoutBtn.addEventListener("click", async () => {
  await logout();
  window.location.href = "index.html";
});

createForm.addEventListener("submit", async (e) => {
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
  createForm.reset();
  document.getElementById("t-turns").value = 30;
  document.getElementById("t-noise").value = 0;
  await refreshTournaments();
});

async function refreshTournaments() {
  const q = query(collection(db, "tournaments"), orderBy("created_at", "desc"));
  const snap = await getDocs(q);
  tList.innerHTML = "";
  if (snap.empty) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Aucun tournoi pour le moment.";
    tList.appendChild(li);
    return;
  }
  snap.forEach((d) => {
    const t = d.data();
    const li = document.createElement("li");
    li.innerHTML = `
      <div class="t-row">
        <strong>${escapeHtml(t.name)}</strong>
        <span class="badge">${escapeHtml(t.status)}</span>
        <span class="meta">phase ${t.phase} · ${t.nb_turns} tours · bruit ${(t.noise_level * 100).toFixed(0)}%</span>
        <a href="teams.html?t=${encodeURIComponent(d.id)}" class="link-btn">Équipes →</a>
        <button data-id="${d.id}" class="del-btn" type="button">Supprimer</button>
      </div>
    `;
    tList.appendChild(li);
  });
  tList.querySelectorAll(".del-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Supprimer ce tournoi définitivement ?")) return;
      await deleteDoc(doc(db, "tournaments", btn.dataset.id));
      await refreshTournaments();
    });
  });
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
