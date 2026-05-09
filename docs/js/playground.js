import { initSidebar } from "./sidebar.js";
import { t, getLang } from "./i18n.js";
import { loadTeamContext } from "./team-context.js";
import { db } from "./firebase-config.js";
import {
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

initSidebar("playground");

const STARTER_CODES = {
  en: `"""
Your bot for the Axelrod Tournament.
Write ONLY the play() function below.
'C' = Cooperate, 'D' = Defect.
"""

import random


def play(my_history, opp_history):
    # Round 0: no information yet about the opponent
    if not opp_history:
        return 'C'

    # Strategy: your move.
    # A few directions to explore (don't just copy):
    #   - tit_for_tat          : copy the opponent's last move
    #   - grudger              : if they ever defect, defect forever
    #   - pavlov               : win-stay, lose-shift
    #   - generous-tit-for-tat : forgive 10% of the time

    return 'C'
`,
  fr: `"""
Ton bot pour le Tournoi Axelrod.
Écris UNIQUEMENT la fonction play() ci-dessous.
'C' = Coopérer, 'D' = Trahir.
"""

import random


def play(my_history, opp_history):
    # Tour 0 : aucune information sur l'adversaire
    if not opp_history:
        return 'C'

    # Stratégie : à toi de jouer.
    # Quelques pistes à explorer (sans copier directement) :
    #   - tit_for_tat          : copie le dernier coup adverse
    #   - grudger              : si jamais il a trahi, je trahis toujours
    #   - pavlov               : win-stay, lose-shift
    #   - generous-tit-for-tat : pardonne 10% du temps

    return 'C'
`
};

function getStarterCode() {
  return STARTER_CODES[getLang()] || STARTER_CODES.en;
}

const els = {
  loadingBanner: document.getElementById("loading-banner"),
  noTeam: document.getElementById("no-team"),
  main: document.getElementById("main"),
  teamHero: document.getElementById("team-hero"),
  teamAvatar: document.getElementById("team-avatar"),
  teamName: document.getElementById("team-name"),
  teamKicker: document.getElementById("team-kicker"),
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
  matchAvatarYou: document.getElementById("match-avatar-you"),
  matchAvatarOpp: document.getElementById("match-avatar-opp"),
  oppFighterName: document.getElementById("opp-fighter-name"),
  scoreA: document.getElementById("score-a"),
  scoreB: document.getElementById("score-b"),
  oppLabel: document.getElementById("opp-label"),
  historyA: document.getElementById("history-a"),
  historyB: document.getElementById("history-b"),
  historyAxis: document.getElementById("history-axis"),
  matchGraph: document.getElementById("match-graph"),
  matchStats: document.getElementById("match-stats"),
  noiseNote: document.getElementById("noise-note"),
  arenaError: document.getElementById("arena-error"),
  submitBtn: document.getElementById("submit-btn"),
  submitMsg: document.getElementById("submit-msg"),
  submissions: document.getElementById("submissions")
};

let pyodide = null;
let editor = null;
let context = null;
let matchChart = null;
let lastResult = null;
let lastOpponent = null;

const PAYOFF = {
  CC: [3, 3], CD: [0, 5], DC: [5, 0], DD: [1, 1]
};

loadTeamContext({
  onLoaded: async (ctx) => {
    context = ctx;
    renderTeamHeader();
    await initEditor();
    await refreshSubmissions();
    els.main.hidden = false;
    await initPyodide();
  },
  onNoTeam: () => {
    els.loadingBanner.hidden = true;
    els.noTeam.hidden = false;
  }
});

function renderTeamHeader() {
  const team = context.team;
  const tournament = context.tournament;
  const hue = teamHue(team.display_name);
  els.teamHero.style.setProperty("--team-hue", hue);
  els.teamHero.style.setProperty("--team-color", `hsl(${hue} 75% 65%)`);
  els.teamName.textContent = team.display_name;
  const emojiPart = team.emoji ? `${team.emoji} ` : "";
  els.teamKicker.textContent = `${emojiPart}${t("team.kicker", { tournament: tournament.name })}`;
  els.teamMeta.innerHTML = t("team.meta.html", {
    phase: tournament.phase,
    turns: tournament.nb_turns,
    noise: (tournament.noise_level * 100).toFixed(0)
  });
  const url = avatarUrl(team.display_name);
  els.teamAvatar.innerHTML = `<img src="${url}" alt="${escapeHtml(team.display_name)}" />`;
  els.matchAvatarYou.innerHTML = `<img src="${url}" alt="" />`;
  els.arenaTurns.value = tournament.nb_turns;
  els.arenaNoise.value = tournament.noise_level;
}

function avatarUrl(seed) {
  return `https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${encodeURIComponent(seed)}&backgroundColor=transparent`;
}

function teamHue(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  return Math.abs(hash) % 360;
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
    value: saved || getStarterCode(),
    language: "python",
    theme: "vs-dark",
    minimap: { enabled: false },
    fontSize: 13,
    fontFamily: "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace",
    fontLigatures: true,
    automaticLayout: true,
    scrollBeyondLastLine: false,
    tabSize: 4,
    insertSpaces: true,
    padding: { top: 12, bottom: 12 }
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
    els.loadingBanner.textContent = t("loading.pyodide.error");
    els.loadingBanner.classList.add("error");
  }
}

function pythonValidate(code) {
  pyodide.globals.set("_user_code", code);
  const proxy = pyodide.runPython("validate_bot_code(_user_code)");
  const result = proxy.toJs({ dict_converter: Object.fromEntries });
  proxy.destroy();
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
  if (!confirm(t("editor.reset.confirm"))) return;
  editor.setValue(getStarterCode());
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
  lastResult = result;
  lastOpponent = opponent;
  els.oppLabel.textContent = opponent;
  els.oppFighterName.textContent = opponent.replace(/_/g, " ");
  els.matchAvatarOpp.innerHTML = `<img src="${avatarUrl(opponent)}" alt="" />`;
  renderHistoryCells(result.history_a, els.historyA);
  renderHistoryCells(result.history_b, els.historyB);
  renderHistoryAxis(result.history_a.length, els.historyAxis);
  renderMatchStats(result, opponent);
  renderMatchGraph(result.history_a, result.history_b);
  if (result.noise_level > 0) {
    els.noiseNote.textContent = t("arena.noise.note", { pct: (result.noise_level * 100).toFixed(0) });
    els.noiseNote.hidden = false;
  } else {
    els.noiseNote.hidden = true;
  }
  els.arenaResult.hidden = false;
  animateCount(els.scoreA, result.score_a);
  animateCount(els.scoreB, result.score_b);
}

function renderHistoryCells(str, container) {
  container.innerHTML = "";
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    const cell = document.createElement("span");
    cell.className = `cell ${c === "C" ? "c" : "d"}`;
    cell.textContent = c;
    const moveLabel = c === "C" ? t("arena.legend.c") : t("arena.legend.d");
    cell.title = `${i + 1} — ${moveLabel}`;
    container.appendChild(cell);
  }
}

function renderHistoryAxis(nbTurns, container) {
  container.innerHTML = "";
  for (let i = 1; i <= nbTurns; i++) {
    const tick = document.createElement("span");
    tick.className = "axis-tick";
    tick.textContent = i % 5 === 0 ? String(i) : "";
    container.appendChild(tick);
  }
}

function renderMatchStats(result, opponent) {
  const ha = result.history_a;
  const hb = result.history_b;
  const nb = ha.length;
  const coopA = countChar(ha, "C");
  const coopB = countChar(hb, "C");
  const coopAPct = ((coopA / nb) * 100).toFixed(0);
  const coopBPct = ((coopB / nb) * 100).toFixed(0);
  const longestA = longestRun(ha);
  const winner = result.score_a > result.score_b ? "win"
                  : result.score_a < result.score_b ? "loss" : "tie";
  const winnerColor = winner === "win" ? "var(--cyan)"
                    : winner === "loss" ? "var(--accent)" : "var(--muted)";
  const winnerLabel = `<span style="color: ${winnerColor};">${t(`arena.result.${winner}`)}</span>`;
  const advantage = Math.abs(result.score_a - result.score_b);

  els.matchStats.innerHTML = `
    <div class="match-stat">
      <span class="match-stat-label">${t("arena.stat.result")}</span>
      <span class="match-stat-value">${winnerLabel}</span>
    </div>
    <div class="match-stat">
      <span class="match-stat-label">${t("arena.stat.duration")}</span>
      <span class="match-stat-value">${t("arena.stat.duration.value", { n: nb })}</span>
    </div>
    <div class="match-stat">
      <span class="match-stat-label">${t("arena.stat.cooperation")}</span>
      <span class="match-stat-value">${coopAPct}%<span class="vs">vs</span>${coopBPct}%</span>
    </div>
    <div class="match-stat">
      <span class="match-stat-label">${t("arena.stat.advantage")}</span>
      <span class="match-stat-value">${advantage > 0 ? "+" + advantage : "0"}</span>
    </div>
    <div class="match-stat">
      <span class="match-stat-label">${t("arena.stat.longestC")}</span>
      <span class="match-stat-value">${longestA.c}</span>
    </div>
    <div class="match-stat">
      <span class="match-stat-label">${t("arena.stat.longestD")}</span>
      <span class="match-stat-value">${longestA.d}</span>
    </div>
  `;
}

function countChar(s, ch) {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

function longestRun(s) {
  let best = { c: 0, d: 0 };
  let cur = { char: null, n: 0 };
  for (const ch of s) {
    if (ch === cur.char) cur.n++;
    else { cur = { char: ch, n: 1 }; }
    if (cur.char === "C" && cur.n > best.c) best.c = cur.n;
    if (cur.char === "D" && cur.n > best.d) best.d = cur.n;
  }
  return best;
}

function renderMatchGraph(ha, hb) {
  if (!window.Chart) return;
  const labels = ha.split("").map((_, i) => i + 1);
  const cumA = cumulativeScores(ha, hb, "a");
  const cumB = cumulativeScores(ha, hb, "b");
  if (matchChart) {
    matchChart.data.labels = labels;
    matchChart.data.datasets[0].data = cumA;
    matchChart.data.datasets[0].label = t("arena.you");
    matchChart.data.datasets[1].data = cumB;
    matchChart.data.datasets[1].label = t("arena.adversary");
    matchChart.update();
    return;
  }
  matchChart = new window.Chart(els.matchGraph, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: t("arena.you"),
          data: cumA,
          borderColor: "#5fe3d8",
          backgroundColor: "rgba(95, 227, 216, 0.12)",
          borderWidth: 2,
          tension: 0.25,
          pointRadius: 0,
          fill: true
        },
        {
          label: t("arena.adversary"),
          data: cumB,
          borderColor: "#ff6b35",
          backgroundColor: "rgba(255, 107, 53, 0.1)",
          borderWidth: 2,
          tension: 0.25,
          pointRadius: 0,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "#7d96a0", font: { size: 10 } } },
        y: { grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "#7d96a0", font: { size: 10 } }, beginAtZero: true }
      },
      plugins: {
        legend: { labels: { color: "#c5d4d9", font: { size: 11 }, usePointStyle: true } },
        tooltip: {
          backgroundColor: "#0c1a1f",
          titleColor: "#fff",
          bodyColor: "#c5d4d9",
          borderColor: "#1d3a3f",
          borderWidth: 1
        }
      }
    }
  });
}

function cumulativeScores(ha, hb, who) {
  const out = [];
  let total = 0;
  for (let i = 0; i < ha.length; i++) {
    const key = ha[i] + hb[i];
    const [pa, pb] = PAYOFF[key];
    total += who === "a" ? pa : pb;
    out.push(total);
  }
  return out;
}

function animateCount(el, target, duration = 600) {
  const current = parseFloat(el.textContent);
  const start = isNaN(current) ? 0 : current;
  if (start === target) {
    el.textContent = String(target);
    return;
  }
  const startTime = performance.now();
  function step(now) {
    const tt = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - tt, 3);
    el.textContent = String(Math.round(start + (target - start) * eased));
    if (tt < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
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
    showValidationMsg(els.submitMsg, validation, validation.ok ? t("submit.saved") : t("submit.invalid"));
    await refreshSubmissions();
  } catch (err) {
    els.submitMsg.hidden = false;
    els.submitMsg.classList.remove("ok");
    els.submitMsg.classList.add("ko");
    els.submitMsg.textContent = t("submit.error", { msg: err.message || err });
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
    li.textContent = t("submit.history.empty");
    els.submissions.appendChild(li);
    els.botStatusBadge.textContent = t("team.bot.none");
    els.botStatusBadge.className = "badge";
    return;
  }
  let validCount = 0;
  const localeForDates = document.documentElement.lang === "fr" ? "fr-FR" : "en-GB";
  snap.forEach((d) => {
    const data = d.data();
    if (data.validation_status === "ok") validCount++;
    const li = document.createElement("li");
    const ts = data.submitted_at?.toDate?.() ?? null;
    const tsStr = ts ? ts.toLocaleString(localeForDates) : t("submit.pending");
    const badge = data.validation_status === "ok" ? t("submit.badge.valid") : t("submit.badge.error");
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
    const key = validCount > 1 ? "team.bot.valid.many" : "team.bot.valid.one";
    els.botStatusBadge.textContent = t(key, { n: validCount });
    els.botStatusBadge.className = "badge ok";
  } else {
    els.botStatusBadge.textContent = t("team.bot.invalid");
    els.botStatusBadge.className = "badge ko";
  }
}

document.addEventListener("langchange", () => {
  if (context) renderTeamHeader();
  if (lastResult && lastOpponent) {
    renderMatchStats(lastResult, lastOpponent);
    if (lastResult.noise_level > 0) {
      els.noiseNote.textContent = t("arena.noise.note", { pct: (lastResult.noise_level * 100).toFixed(0) });
    }
    if (matchChart) {
      matchChart.data.datasets[0].label = t("arena.you");
      matchChart.data.datasets[1].label = t("arena.adversary");
      matchChart.update();
    }
  }
  if (context) refreshSubmissions();
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}
