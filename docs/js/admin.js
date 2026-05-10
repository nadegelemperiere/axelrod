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
  main.hidden = false;
  await refreshTournaments();
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
    li.textContent = t("admin.list.empty");
    tList.appendChild(li);
    return;
  }
  snap.forEach((d) => {
    const data = d.data();
    const hue = hashHue(d.id);
    const statusBadge = data.status === "running" ? "live" : (data.status === "completed" ? "ok" : "");
    const statusLabel = t(`admin.status.${data.status}`);
    const meta = t("admin.tournament.meta", {
      phase: data.phase,
      turns: data.nb_turns,
      noise: (data.noise_level * 100).toFixed(0)
    });
    const li = document.createElement("li");
    li.innerHTML = `
      <div class="t-row">
        <span class="hex-icon" style="--team-color: hsl(${hue} 75% 60%)">${hexIconSvg(hue)}</span>
        <div style="display: flex; flex-direction: column; gap: 0.15rem; min-width: 0;">
          <strong>${escapeHtml(data.name)}</strong>
          <span class="meta">${escapeHtml(meta)}</span>
        </div>
        <span class="badge ${statusBadge}">${escapeHtml(statusLabel)}</span>
        <a href="tournament.html?t=${encodeURIComponent(d.id)}" class="link-btn">${t("admin.teams")}</a>
        <button data-id="${d.id}" class="del-btn" type="button">${t("admin.delete")}</button>
      </div>
    `;
    tList.appendChild(li);
  });
  tList.querySelectorAll(".del-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("admin.delete.confirm"))) return;
      await deleteDoc(doc(db, "tournaments", btn.dataset.id));
      await refreshTournaments();
    });
  });
}

document.addEventListener("langchange", () => {
  if (!main.hidden) refreshTournaments();
});

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
  return `<svg viewBox="0 0 56 56" width="48" height="48" xmlns="http://www.w3.org/2000/svg">
    <polygon points="28,4 48,16 48,40 28,52 8,40 8,16" fill="${color}" fill-opacity="0.15" stroke="${color}" stroke-width="1.5"/>
    <polygon points="28,14 38,20 38,32 28,38 18,32 18,20" fill="${color}" fill-opacity="0.4"/>
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
