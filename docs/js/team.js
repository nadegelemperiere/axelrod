import { onAuth, logout, isUserAdmin } from "./auth.js";
import { db } from "./firebase-config.js";
import {
  doc,
  getDoc,
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

const STARTER_CODE = `"""
Votre bot pour le Tournoi Axelrod.
Écrivez UNIQUEMENT la fonction play() ci-dessous.
'C' = Coopérer, 'D' = Trahir.
"""

import random


def play(my_history, opp_history):
    # Tour 0 : aucune information sur l'adversaire
    if not opp_history:
        return 'C'

    # Stratégie : à toi de jouer.
    # Quelques pistes à explorer (sans copier directement) :
    #   - tit_for_tat        : copie le dernier coup adverse
    #   - grudger            : si jamais il a trahi, je trahis toujours
    #   - pavlov             : win-stay, lose-shift
    #   - generous-tit-for-tat : pardonne 10% du temps

    return 'C'
`;

const els = {
  loadingBanner: document.getElementById("loading-banner"),
  noTeam: document.getElementById("no-team"),
  main: document.getElementById("main"),
  userEmail: document.getElementById("user-email"),
  logoutBtn: document.getElementById("logout-btn"),
  teamName: document.getElementById("team-name"),
  teamEmoji: document.getElementById("team-emoji"),
  teamMeta: document.getElementById("team-meta"),
  botStatusBadge: document.getElementById("bot-status-badge"),
  editor: document.getElementById("editor"),
  resetBtn: document.getElementById("reset-btn"),
  validateBtn: document.getElementById("validate-btn"),
  validationMsg: document.getElementById("validation-msg"),
  opponent: document.getElementById("opponent"),
  arenaTurns: document.getElementById("arena-turns"),
  arenaNoise: document.getElementById("arena-noise"),
  arenaSeed: document.getElementById("arena-seed"),
  runBtn: document.getElementById("run-btn"),
  arenaResult: document.getElementById("arena-result"),
  scoreA: document.getElementById("score-a"),
  scoreB: document.getElementById("score-b"),
  oppLabel: document.getElementById("opp-label"),
  historyA: document.getElementById("history-a"),
  historyB: document.getElementById("history-b"),
  noiseNote: document.getElementById("noise-note"),
  arenaError: document.getElementById("arena-error"),
  submitBtn: document.getElementById("submit-btn"),
  submitMsg: document.getElementById("submit-msg"),
  submissions: document.getElementById("submissions")
};

let pyodide = null;
let editor = null;
let context = null; // { uid, tournamentId, teamId, tournament, team }

onAuth(async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  const admin = await isUserAdmin(user.uid);
  if (admin) {
    window.location.href = "admin.html";
    return;
  }
  els.userEmail.textContent = user.email;

  const userDoc = await getDoc(doc(db, "users", user.uid));
  if (!userDoc.exists()) {
    els.loadingBanner.hidden = true;
    els.noTeam.hidden = false;
    return;
  }
  const { tournament_id, team_id } = userDoc.data();
  const [tSnap, teamSnap] = await Promise.all([
    getDoc(doc(db, "tournaments", tournament_id)),
    getDoc(doc(db, "tournaments", tournament_id, "teams", team_id))
  ]);
  if (!tSnap.exists() || !teamSnap.exists()) {
    els.loadingBanner.hidden = true;
    els.noTeam.hidden = false;
    return;
  }
  context = {
    uid: user.uid,
    tournamentId: tournament_id,
    teamId: team_id,
    tournament: tSnap.data(),
    team: teamSnap.data()
  };

  renderTeamHeader();
  await initEditor();
  await refreshSubmissions();
  els.main.hidden = false;
  await initPyodide();
});

els.logoutBtn.addEventListener("click", async () => {
  await logout();
  window.location.href = "index.html";
});

function renderTeamHeader() {
  els.teamName.textContent = context.team.display_name;
  els.teamEmoji.textContent = context.team.emoji || "";
  const t = context.tournament;
  els.teamMeta.textContent = `${t.name} · phase ${t.phase} · ${t.nb_turns} tours · bruit ${(t.noise_level * 100).toFixed(0)}%`;
  // pré-remplit l'arène avec les paramètres du tournoi
  els.arenaTurns.value = t.nb_turns;
  els.arenaNoise.value = t.noise_level;
}

function storageKey() {
  return `axelrod-code-${context.tournamentId}-${context.teamId}`;
}

async function initEditor() {
  await new Promise((resolve) => {
    window.require.config({ paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.50.0/min/vs" } });
    window.require(["vs/editor/editor.main"], resolve);
  });
  const saved = localStorage.getItem(storageKey());
  editor = window.monaco.editor.create(els.editor, {
    value: saved || STARTER_CODE,
    language: "python",
    theme: "vs-light",
    minimap: { enabled: false },
    fontSize: 13,
    automaticLayout: true,
    scrollBeyondLastLine: false,
    tabSize: 4,
    insertSpaces: true
  });
  editor.onDidChangeModelContent(() => {
    localStorage.setItem(storageKey(), editor.getValue());
  });
}

async function initPyodide() {
  try {
    const { loadPyodide } = await import("https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.mjs");
    pyodide = await loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/" });
    const sandboxCode = await fetch("./sandbox.py").then((r) => r.text());
    pyodide.runPython(sandboxCode);
    els.loadingBanner.hidden = true;
    els.runBtn.disabled = false;
    els.submitBtn.disabled = false;
  } catch (err) {
    console.error("Pyodide init failed", err);
    els.loadingBanner.textContent = "Erreur au chargement de Python. Recharge la page.";
    els.loadingBanner.classList.add("error");
  }
}

function pythonValidate(code) {
  pyodide.globals.set("_user_code", code);
  const proxy = pyodide.runPython("validate_bot_code(_user_code)");
  const result = proxy.toJs({ dict_converter: Object.fromEntries });
  proxy.destroy();
  // strip the 'play' callable so we just return JSON-friendly bits
  return { ok: result.ok, message: result.message };
}

function pythonRunTest(code, opponent, nbTurns, noise, seed) {
  pyodide.globals.set("_user_code", code);
  pyodide.globals.set("_opp", opponent);
  pyodide.globals.set("_nb", nbTurns);
  pyodide.globals.set("_noise", noise);
  pyodide.globals.set("_seed", seed);
  const proxy = pyodide.runPython("run_test(_user_code, _opp, _nb, _noise, _seed)");
  const result = proxy.toJs({ dict_converter: Object.fromEntries });
  proxy.destroy();
  return result;
}

els.resetBtn.addEventListener("click", () => {
  if (!confirm("Restaurer le modèle de départ ? Tu perds le code actuel.")) return;
  editor.setValue(STARTER_CODE);
});

els.validateBtn.addEventListener("click", () => {
  if (!pyodide) return;
  const code = editor.getValue();
  const result = pythonValidate(code);
  showValidationMsg(els.validationMsg, result);
});

els.runBtn.addEventListener("click", () => {
  if (!pyodide) return;
  els.arenaError.hidden = true;
  els.arenaResult.hidden = true;
  const code = editor.getValue();
  const opponent = els.opponent.value;
  const nbTurns = parseInt(els.arenaTurns.value, 10) || 30;
  const noise = parseFloat(els.arenaNoise.value) || 0;
  const seedRaw = els.arenaSeed.value;
  const seed = seedRaw === "" ? null : parseInt(seedRaw, 10);

  const result = pythonRunTest(code, opponent, nbTurns, noise, seed);
  if (!result.ok) {
    els.arenaError.textContent = result.error;
    els.arenaError.hidden = false;
    return;
  }
  renderArenaResult(result, opponent);
});

function renderArenaResult(result, opponent) {
  els.scoreA.textContent = result.score_a;
  els.scoreB.textContent = result.score_b;
  els.oppLabel.textContent = opponent;
  renderHistory(result.history_a, els.historyA);
  renderHistory(result.history_b, els.historyB);
  if (result.noise_level > 0) {
    els.noiseNote.textContent = `Bruit ${(result.noise_level * 100).toFixed(0)}% appliqué : les coups affichés sont ceux reçus par l'adversaire (après inversions aléatoires).`;
    els.noiseNote.hidden = false;
  } else {
    els.noiseNote.hidden = true;
  }
  els.arenaResult.hidden = false;
}

function renderHistory(str, container) {
  container.innerHTML = "";
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    const span = document.createElement("span");
    span.textContent = c;
    span.className = c === "C" ? "move-c" : "move-d";
    span.title = `Tour ${i + 1}`;
    container.appendChild(span);
    if ((i + 1) % 5 === 0 && i < str.length - 1) {
      container.appendChild(document.createTextNode(" "));
    }
  }
}

function showValidationMsg(el, result, prefix = "") {
  el.hidden = false;
  el.classList.remove("ok", "ko");
  el.classList.add(result.ok ? "ok" : "ko");
  el.textContent = (prefix ? prefix + " " : "") + result.message;
}

els.submitBtn.addEventListener("click", async () => {
  if (!pyodide) return;
  els.submitMsg.hidden = true;
  els.submitBtn.disabled = true;
  try {
    const code = editor.getValue();
    const validation = pythonValidate(code);
    await addDoc(
      collection(db, "tournaments", context.tournamentId, "teams", context.teamId, "bots"),
      {
        code,
        submitted_at: serverTimestamp(),
        validation_status: validation.ok ? "ok" : "error",
        validation_message: validation.message
      }
    );
    showValidationMsg(els.submitMsg, validation, validation.ok ? "Soumission enregistrée." : "Soumission enregistrée mais NON valide :");
    await refreshSubmissions();
  } catch (err) {
    els.submitMsg.hidden = false;
    els.submitMsg.classList.remove("ok");
    els.submitMsg.classList.add("ko");
    els.submitMsg.textContent = `Erreur d'envoi: ${err.message || err}`;
    console.error(err);
  } finally {
    els.submitBtn.disabled = false;
  }
});

async function refreshSubmissions() {
  const ref = collection(db, "tournaments", context.tournamentId, "teams", context.teamId, "bots");
  const q = query(ref, orderBy("submitted_at", "desc"), limit(5));
  const snap = await getDocs(q);
  els.submissions.innerHTML = "";
  if (snap.empty) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Aucune soumission pour l'instant.";
    els.submissions.appendChild(li);
    els.botStatusBadge.textContent = "aucun bot";
    els.botStatusBadge.className = "badge";
    return;
  }
  let validCount = 0;
  snap.forEach((d) => {
    const data = d.data();
    if (data.validation_status === "ok") validCount++;
    const li = document.createElement("li");
    const ts = data.submitted_at?.toDate?.() ?? null;
    const tsStr = ts ? ts.toLocaleString("fr-FR") : "envoi en cours…";
    const badge = data.validation_status === "ok" ? "validé" : "erreur";
    const badgeClass = data.validation_status === "ok" ? "badge ok" : "badge ko";
    li.innerHTML = `
      <div class="t-row">
        <span class="${badgeClass}">${badge}</span>
        <span class="meta">${escapeHtml(tsStr)}</span>
        <span class="meta validation-detail">${escapeHtml(data.validation_message || "")}</span>
      </div>
    `;
    els.submissions.appendChild(li);
  });
  if (validCount > 0) {
    els.botStatusBadge.textContent = `${validCount} bot${validCount > 1 ? "s" : ""} valide${validCount > 1 ? "s" : ""}`;
    els.botStatusBadge.className = "badge ok";
  } else {
    els.botStatusBadge.textContent = "soumis (invalide)";
    els.botStatusBadge.className = "badge ko";
  }
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
