import { initSidebar } from "./sidebar.js";
import { t, getLang } from "./i18n.js";
import { loadTeamContext } from "./team-context.js";
import { db } from "./firebase-config.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

initSidebar("playground");

// ---------- Starter code ----------
// We deliberately ship NO sample implementation : this is a Python class,
// students must write the play() function themselves. Just a single comment
// shows where the code goes.
const STARTER_CODES = {
  en: `# Write your Python code here.\n`,
  fr: `# Écris ton code Python ici.\n`
};

// Reference bots available to students. Opponents (whether bots or saved
// strategies) are normalized as `{type: "bot"|"strategy", id: string}` —
// see normalizeOpponent / opponentKey below. Legacy string entries from
// localStorage are migrated on read.
const REFERENCE_BOT_IDS = ["always_cooperate", "always_defect", "random"];
const DEFAULT_OPPONENTS = REFERENCE_BOT_IDS.map((id) => ({ type: "bot", id }));

// Resolved at boot from /teams/{uid}/strategies: id -> {name, code}. Only
// strategies that validate successfully are kept (invalid ones would just
// forfeit the match, which is confusing in a learning context).
let teamStrategies = new Map();

const els = {
  loadingBanner: document.getElementById("loading-banner"),
  noTeam: document.getElementById("no-team"),
  main: document.getElementById("main"),
  opponentsList: document.getElementById("opponents-list"),
  addOppBtn: document.getElementById("add-opp-btn"),
  pickerModal: document.getElementById("picker-modal"),
  pickerList: document.getElementById("picker-list"),
  docsBtn: document.getElementById("docs-btn"),
  helpBtn: document.getElementById("help-btn"),
  docsModal: document.getElementById("docs-modal"),
  saveIndicator: document.getElementById("save-indicator"),
  lockBanner: document.getElementById("lock-banner"),
  editor: document.getElementById("editor"),
  resetBtn: document.getElementById("reset-btn"),
  validationMsg: document.getElementById("validation-msg"),
  runBtn: document.getElementById("run-btn"),
  arenaError: document.getElementById("arena-error"),
  matchSection: document.getElementById("match-section"),
  consoleCard: document.getElementById("console-card"),
  consoleOutput: document.getElementById("console-output"),
  matchOppName: document.getElementById("match-opp-name"),
  matchAvatarOpp: document.getElementById("match-avatar-opp"),
  matchAvatarYou: document.getElementById("match-avatar-you"),
  matchAxis: document.getElementById("match-axis"),
  historyA: document.getElementById("history-a"),
  historyB: document.getElementById("history-b"),
  resultsScoreYou: document.getElementById("results-score-you"),
  resultsScoreOpp: document.getElementById("results-score-opp"),
  resultsOutcome: document.getElementById("results-outcome"),
  resultsDuration: document.getElementById("results-duration"),
  resultsCoopYou: document.getElementById("results-coop-you"),
  resultsCoopOpp: document.getElementById("results-coop-opp"),
  analysisSection: document.getElementById("analysis-section"),
  matchGraph: document.getElementById("match-graph"),
  matchStats: document.getElementById("match-stats"),
  fullAnalysisText: document.getElementById("full-analysis-text"),
  quickAnalysisText: document.getElementById("quick-analysis-text"),
  saveBtn: document.getElementById("save-btn"),
  submitBtn: document.getElementById("submit-btn"),
  submitMsg: document.getElementById("submit-msg"),
  saveModal: document.getElementById("save-modal"),
  saveName: document.getElementById("save-name"),
  saveDescription: document.getElementById("save-description"),
  saveConfirmBtn: document.getElementById("save-confirm-btn"),
  submitModal: document.getElementById("submit-modal"),
  submitChecking: document.getElementById("submit-checking"),
  submitBlocked: document.getElementById("submit-blocked"),
  submitBlockedMsg: document.getElementById("submit-blocked-msg"),
  submitFormContent: document.getElementById("submit-form-content"),
  submitTournament: document.getElementById("submit-tournament"),
  submitName: document.getElementById("submit-name"),
  submitConfirmBtn: document.getElementById("submit-confirm-btn")
};

let activeStrategyId = null;
let activeStrategyName = null;
let activeStrategyLocked = false;
let activeStrategyLockedTournament = null;

const PAYOFF = { CC: [3, 3], CD: [0, 5], DC: [5, 0], DD: [1, 1] };

let pyodide = null;
let editor = null;
let context = null;
let matchChart = null;
let lastResult = null;
let lastOpponent = null;
let opponents = [];
let selectedOpponent = null;
let activeTab = "graph";

// Results cache keyed by opponentKey(opp). Each entry is
// {result, captured, codeVersion}. We bump codeVersion on every edit so that
// clicking back to an already-tested opponent re-runs if the code has changed,
// but is instant otherwise (avoids reshuffling random/noisy outcomes).
const resultsCache = new Map();
let codeVersion = 0;

// ---------- Boot ----------
loadTeamContext({
  onLoaded: async (ctx) => {
    context = ctx;
    await loadTeamStrategies();
    opponents = loadOpponents();
    selectedOpponent = opponents[0] || DEFAULT_OPPONENTS[0];
    setMatchAvatarYou(ctx.team.display_name);
    renderOpponents();

    // Load strategy from URL param if any (overrides localStorage starter).
    const params = new URLSearchParams(window.location.search);
    const strategyParam = params.get("strategy");
    let initialCode = null;
    if (strategyParam) {
      try {
        const sSnap = await getDoc(
          doc(db, "teams", ctx.uid, "strategies", strategyParam)
        );
        if (sSnap.exists()) {
          const data = sSnap.data();
          activeStrategyId = strategyParam;
          activeStrategyName = data.name || null;
          initialCode = data.code || null;
          if (data.last_submitted_at) {
            activeStrategyLocked = true;
            // Look up the tournament name live (not denormalized)
            const tid = data.last_submitted_tournament_id;
            if (tid) {
              const tSnap = await getDoc(doc(db, "tournaments", tid));
              activeStrategyLockedTournament = tSnap.exists() ? (tSnap.data().name || "?") : "?";
            } else {
              activeStrategyLockedTournament = "?";
            }
          }
        }
      } catch (e) {
        console.warn("Failed to load strategy from URL", e);
      }
    }

    await initEditor(initialCode);
    els.main.hidden = false;
    if (activeStrategyName && !activeStrategyLocked) {
      showValidationMsg(els.validationMsg,
        { ok: true, message: t("playground.loaded.from.strategy", { name: activeStrategyName }) });
    }
    if (activeStrategyLocked) {
      applyLockedState();
    }
    await initPyodide();
  },
  onNoTeam: () => {
    els.loadingBanner.hidden = true;
    els.noTeam.hidden = false;
  }
});

// ---------- Editor ----------
function getStarterCode() {
  return STARTER_CODES[getLang()] || STARTER_CODES.en;
}

function storageKey() {
  return `axelrod-code-${context.uid}`;
}

function opponentsKey() {
  return `axelrod-opponents-${context.uid}`;
}

// Normalize a stored entry into `{type, id}`. Legacy entries are bare strings
// referring to reference bot ids — wrap them. Drop anything we can no longer
// resolve (deleted strategies, unknown bots).
function normalizeOpponent(raw) {
  if (typeof raw === "string") {
    return REFERENCE_BOT_IDS.includes(raw) ? { type: "bot", id: raw } : null;
  }
  if (!raw || typeof raw !== "object") return null;
  if (raw.type === "bot") {
    return REFERENCE_BOT_IDS.includes(raw.id) ? { type: "bot", id: raw.id } : null;
  }
  if (raw.type === "strategy") {
    return teamStrategies.has(raw.id) ? { type: "strategy", id: raw.id } : null;
  }
  return null;
}

function opponentKey(opp) {
  return `${opp.type}:${opp.id}`;
}

function loadOpponents() {
  const stored = localStorage.getItem(opponentsKey());
  if (!stored) return [...DEFAULT_OPPONENTS];
  try {
    const arr = JSON.parse(stored);
    if (Array.isArray(arr)) {
      const normalized = arr.map(normalizeOpponent).filter(Boolean);
      if (normalized.length > 0) return normalized;
    }
  } catch {}
  return [...DEFAULT_OPPONENTS];
}

function saveOpponents() {
  localStorage.setItem(opponentsKey(), JSON.stringify(opponents));
}

async function loadTeamStrategies() {
  teamStrategies = new Map();
  try {
    const snap = await getDocs(collection(db, "teams", context.uid, "strategies"));
    snap.forEach((d) => {
      const data = d.data();
      if (data.validation_status === "ok" && data.code) {
        teamStrategies.set(d.id, { name: data.name || "(untitled)", code: data.code });
      }
    });
  } catch (e) {
    console.warn("Failed to load team strategies for opponents picker", e);
  }
}

async function initEditor(initialCode) {
  await new Promise((resolve) => {
    window.require.config({ paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.50.0/min/vs" } });
    window.require(["vs/editor/editor.main"], resolve);
  });
  const saved = initialCode != null ? initialCode : localStorage.getItem(storageKey());
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
  let saveTimer = null;
  setSaveState(true);
  editor.onDidChangeModelContent(() => {
    setSaveState(false);
    codeVersion++;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      localStorage.setItem(storageKey(), editor.getValue());
      setSaveState(true);
    }, 400);
  });
}

function setSaveState(saved) {
  els.saveIndicator.classList.toggle("unsaved", !saved);
  els.saveIndicator.textContent = saved ? t("playground.editor.saved") : t("playground.editor.unsaved");
}

// ---------- Pyodide ----------
// Captures everything the student's strategy prints to stdout/stderr during
// a match, so we can display it in the "Console output" card after the run.
// IMPORTANT : we clear with `.length = 0` (mutate in place) — never reassign,
// otherwise the closure inside pyodide.setStdout keeps writing to the orphan
// array and the captured output silently disappears.
const printBuffer = [];

async function initPyodide() {
  try {
    const { loadPyodide } = await import("https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.mjs");
    pyodide = await loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/" });
    // Redirect Python stdout/stderr to our buffer (batched = one call per
    // line, auto-flushed on newline).
    pyodide.setStdout({ batched: (line) => printBuffer.push(line) });
    pyodide.setStderr({ batched: (line) => printBuffer.push("[stderr] " + line) });
    const sandboxCode = await fetch("./sandbox.py").then((r) => r.text());
    pyodide.runPython(sandboxCode);
    els.loadingBanner.hidden = true;
    els.runBtn.disabled = false;
    els.saveBtn.disabled = activeStrategyLocked;
    els.submitBtn.disabled = false;
  } catch (err) {
    console.error("Pyodide init failed", err);
    els.loadingBanner.textContent = t("loading.pyodide.error");
    els.loadingBanner.classList.add("error");
  }
}

function applyLockedState() {
  if (!activeStrategyLocked) return;
  els.lockBanner.hidden = false;
  els.lockBanner.textContent = t("strategies.locked.playground", {
    name: activeStrategyLockedTournament || "?"
  });
  if (editor) editor.updateOptions({ readOnly: true });
  els.saveBtn.disabled = true;
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

function pythonRunTwoStrategies(codeA, codeB, nbTurns, noise, seed) {
  pyodide.globals.set("_code_a", codeA);
  pyodide.globals.set("_code_b", codeB);
  pyodide.globals.set("_nb", nbTurns);
  pyodide.globals.set("_noise", noise);
  pyodide.globals.set("_seed", seed);
  const proxy = pyodide.runPython("run_test_two_codes(_code_a, _code_b, _nb, _noise, _seed)");
  const result = proxy.toJs({ dict_converter: Object.fromEntries });
  proxy.destroy();
  return result;
}

function pythonAnalyze(my_h, opp_h) {
  pyodide.globals.set("_my_h", my_h);
  pyodide.globals.set("_opp_h", opp_h);
  const proxy = pyodide.runPython("analyze_strategy(_my_h, _opp_h)");
  const result = proxy.toJs({ dict_converter: Object.fromEntries });
  proxy.destroy();
  return result;
}

// ---------- Avatars ----------
function avatarUrl(seed) {
  return `https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${encodeURIComponent(seed)}&backgroundColor=transparent`;
}

function setMatchAvatarYou(seed) {
  els.matchAvatarYou.src = avatarUrl(seed);
}

// ---------- Opponents list ----------
function opponentLabel(opp) {
  if (opp.type === "strategy") {
    const s = teamStrategies.get(opp.id);
    return s ? s.name : "(deleted)";
  }
  return opp.id.split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

function opponentAvatarSeed(opp) {
  // Use a "team:" prefix on strategy avatars so they look distinct from
  // reference bots even if the names happen to collide.
  return opp.type === "strategy" ? `team:${opp.id}` : opp.id;
}

function renderOpponents() {
  els.opponentsList.innerHTML = "";
  for (const opp of opponents) {
    const li = document.createElement("li");
    const isSelected = selectedOpponent && opponentKey(selectedOpponent) === opponentKey(opp);
    li.className = "opponent-item" + (isSelected ? " selected" : "");
    if (opp.type === "strategy") li.classList.add("opponent-strategy");
    li.dataset.oppType = opp.type;
    li.dataset.oppId = opp.id;
    li.innerHTML = `
      <img class="opp-avatar" src="${avatarUrl(opponentAvatarSeed(opp))}" alt="" />
      <span class="opp-name">${escapeHtml(opponentLabel(opp))}</span>
      <button class="opp-remove" type="button" data-i18n-title="playground.opponents.remove" aria-label="remove">×</button>
    `;
    li.addEventListener("click", (e) => {
      if (e.target.classList.contains("opp-remove")) return;
      selectedOpponent = opp;
      renderOpponents();
      runMatchAgainst(opp);
    });
    li.querySelector(".opp-remove").addEventListener("click", (e) => {
      e.stopPropagation();
      const removedKey = opponentKey(opp);
      opponents = opponents.filter((o) => opponentKey(o) !== removedKey);
      resultsCache.delete(removedKey);
      if (selectedOpponent && opponentKey(selectedOpponent) === removedKey) {
        selectedOpponent = opponents[0] || null;
        if (selectedOpponent) runMatchAgainst(selectedOpponent);
      }
      saveOpponents();
      renderOpponents();
    });
    els.opponentsList.appendChild(li);
  }
}

els.addOppBtn.addEventListener("click", openPicker);

function openPicker() {
  els.pickerList.innerHTML = "";
  const usedKeys = new Set(opponents.map(opponentKey));

  const availableBots = REFERENCE_BOT_IDS
    .map((id) => ({ type: "bot", id }))
    .filter((o) => !usedKeys.has(opponentKey(o)));
  const availableStrats = [...teamStrategies.keys()]
    .map((id) => ({ type: "strategy", id }))
    .filter((o) => !usedKeys.has(opponentKey(o)));

  if (availableBots.length === 0 && availableStrats.length === 0) {
    const li = document.createElement("li");
    li.className = "opponent-item";
    li.innerHTML = `<span class="opp-name muted">${t("playground.opponents.picker.empty")}</span>`;
    els.pickerList.appendChild(li);
    openModal(els.pickerModal);
    return;
  }

  appendPickerSection(t("playground.opponents.picker.section.bots"), availableBots);
  appendPickerSection(t("playground.opponents.picker.section.mine"), availableStrats,
    t("playground.opponents.picker.mine.empty"));

  openModal(els.pickerModal);
}

function appendPickerSection(title, items, emptyHint) {
  const header = document.createElement("li");
  header.className = "picker-section-header";
  header.textContent = title;
  els.pickerList.appendChild(header);

  if (items.length === 0) {
    if (emptyHint) {
      const li = document.createElement("li");
      li.className = "opponent-item";
      li.innerHTML = `<span class="opp-name muted">${escapeHtml(emptyHint)}</span>`;
      els.pickerList.appendChild(li);
    }
    return;
  }

  for (const opp of items) {
    const li = document.createElement("li");
    li.className = "opponent-item";
    if (opp.type === "strategy") li.classList.add("opponent-strategy");
    li.innerHTML = `
      <img class="opp-avatar" src="${avatarUrl(opponentAvatarSeed(opp))}" alt="" />
      <span class="opp-name">${escapeHtml(opponentLabel(opp))}</span>
    `;
    li.addEventListener("click", () => {
      opponents.push(opp);
      selectedOpponent = opp;
      saveOpponents();
      renderOpponents();
      closeModal(els.pickerModal);
      runMatchAgainst(opp);
    });
    els.pickerList.appendChild(li);
  }
}

// ---------- Modals ----------
els.docsBtn.addEventListener("click", () => openModal(els.docsModal));
els.helpBtn.addEventListener("click", () => openModal(els.docsModal));

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

// ---------- Match run ----------
els.resetBtn.addEventListener("click", () => {
  if (!confirm(t("editor.reset.confirm"))) return;
  editor.setValue(getStarterCode());
});

// Run a match against `opp`, or pull the result from cache if the code hasn't
// changed since we last ran it. `force=true` skips the cache (used by the Run
// button to let students re-roll random/noisy outcomes).
function runMatchAgainst(opp, { force = false } = {}) {
  if (!pyodide) return;
  if (!opp) {
    els.arenaError.textContent = "No opponent selected.";
    els.arenaError.hidden = false;
    return;
  }
  els.arenaError.hidden = true;

  const key = opponentKey(opp);
  const cached = resultsCache.get(key);
  if (!force && cached && cached.codeVersion === codeVersion) {
    printBuffer.length = 0;
    if (cached.captured) printBuffer.push(cached.captured);
    renderConsoleOutput();
    renderMatch(cached.result, opp);
    return;
  }

  const code = editor.getValue();
  const tournament = context.tournament || { nb_turns: 30, noise_level: 0 };
  const nbTurns = tournament.nb_turns;
  const noise = tournament.noise_level;

  pyodide.runPython("_capture_start()");
  let result;
  if (opp.type === "strategy") {
    const strat = teamStrategies.get(opp.id);
    if (!strat) {
      pyodide.runPython("_capture_end()");
      els.arenaError.textContent = t("playground.opponents.strategy.missing");
      els.arenaError.hidden = false;
      els.matchSection.hidden = true;
      els.analysisSection.hidden = true;
      return;
    }
    result = pythonRunTwoStrategies(code, strat.code, nbTurns, noise, null);
  } else {
    result = pythonRunTest(code, opp.id, nbTurns, noise, null);
  }
  const captured = pyodide.runPython("_capture_end()");
  printBuffer.length = 0;
  if (captured) printBuffer.push(captured);
  renderConsoleOutput();
  if (!result.ok) {
    // Don't cache failures — student will fix code and the version bump will
    // invalidate anyway, but being explicit avoids stale error displays.
    els.arenaError.textContent = result.error;
    els.arenaError.hidden = false;
    els.matchSection.hidden = true;
    els.analysisSection.hidden = true;
    return;
  }
  resultsCache.set(key, { result, captured: captured || "", codeVersion });
  renderMatch(result, opp);
}

els.runBtn.addEventListener("click", () => {
  runMatchAgainst(selectedOpponent, { force: true });
});

function renderConsoleOutput() {
  if (!els.consoleCard) return;
  if (printBuffer.length === 0) {
    els.consoleCard.hidden = true;
    return;
  }
  els.consoleCard.hidden = false;
  els.consoleOutput.textContent = printBuffer.join("\n");
}

function renderMatch(result, opponent) {
  lastResult = result;
  lastOpponent = opponent;
  els.matchSection.hidden = false;
  els.analysisSection.hidden = false;
  // force layout so Chart.js sees real dimensions when initializing
  void els.analysisSection.offsetHeight;

  // Fighters
  els.matchOppName.textContent = opponentLabel(opponent).toUpperCase();
  els.matchAvatarOpp.src = avatarUrl(opponentAvatarSeed(opponent));

  // Cells
  renderCells(result.history_b, els.historyB);
  renderCells(result.history_a, els.historyA);
  renderAxis(result.history_a.length, els.matchAxis);

  // Results
  els.resultsScoreYou.textContent = result.score_a;
  els.resultsScoreOpp.textContent = result.score_b;
  const winner = result.score_a > result.score_b ? "win" : result.score_a < result.score_b ? "loss" : "tie";
  const emoji = winner === "win" ? "🏆" : winner === "loss" ? "💀" : "🤝";
  els.resultsOutcome.innerHTML = `<span style="font-size: 1.4rem;" title="${t(`arena.result.${winner}`)}">${emoji}</span>`;
  els.resultsDuration.textContent = t("arena.stat.duration.value", { n: result.history_a.length });
  const coopA = countChar(result.history_a, "C");
  const coopB = countChar(result.history_b, "C");
  els.resultsCoopYou.textContent = `${((coopA / result.history_a.length) * 100).toFixed(0)}%`;
  els.resultsCoopOpp.textContent = `${((coopB / result.history_b.length) * 100).toFixed(0)}%`;

  // Tabs content
  renderGraph(result.history_a, result.history_b);
  renderDetails(result);
  renderAnalysis(result);
}

function renderCells(str, container) {
  container.innerHTML = "";
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    const cell = document.createElement("span");
    cell.className = `cell ${c === "C" ? "c" : "d"}`;
    cell.textContent = c;
    cell.title = `${i + 1} — ${c === "C" ? t("arena.legend.c") : t("arena.legend.d")}`;
    container.appendChild(cell);
  }
}

function renderAxis(nbTurns, container) {
  container.innerHTML = "";
  for (let i = 1; i <= nbTurns; i++) {
    const tick = document.createElement("span");
    tick.className = "match-axis-tick";
    tick.style.width = "22px";
    tick.textContent = i % 10 === 0 || i === 1 ? String(i) : "";
    container.appendChild(tick);
  }
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

// ---------- Tabs ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    activeTab = btn.dataset.tab;
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".tab-content").forEach((c) => {
      c.hidden = c.id !== `tab-${activeTab}`;
    });
    if (activeTab === "graph" && matchChart) matchChart.resize();
  });
});

// ---------- Graph ----------
let chartLoadPromise = null;
function ensureChartLoaded() {
  if (window.Chart) return Promise.resolve();
  if (chartLoadPromise) return chartLoadPromise;
  chartLoadPromise = (async () => {
    try {
      const mod = await import("https://cdn.jsdelivr.net/npm/chart.js@4.4.4/auto/+esm");
      window.Chart = mod.default || mod.Chart;
      console.log("[playground] Chart.js (ESM) loaded ✓", typeof window.Chart);
    } catch (e) {
      console.error("[playground] Chart.js ESM import failed, trying local UMD fallback…", e);
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "vendor/chart.umd.js?v=2";
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
      console.log("[playground] Chart.js (UMD fallback) loaded ✓", typeof window.Chart);
    }
  })();
  return chartLoadPromise;
}

async function renderGraph(ha, hb) {
  try {
    await ensureChartLoaded();
  } catch (err) {
    console.error("[playground] All Chart.js load attempts failed:", err);
    return;
  }
  if (!window.Chart) {
    console.error("[playground] Chart.js still not available after load attempt.");
    return;
  }
  const labels = ha.split("").map((_, i) => i + 1);
  const cumA = cumulativeScores(ha, hb, "a");
  const cumB = cumulativeScores(ha, hb, "b");
  if (matchChart) {
    matchChart.data.labels = labels;
    matchChart.data.datasets[0].data = cumA;
    matchChart.data.datasets[0].label = t("arena.you");
    matchChart.data.datasets[1].data = cumB;
    matchChart.data.datasets[1].label = t("arena.adversary");
    matchChart.options.scales.x.title.text = t("playground.match.tours");
    matchChart.options.scales.y.title.text = t("playground.results.score");
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
          backgroundColor: "rgba(95, 227, 216, 0.1)",
          borderWidth: 2,
          tension: 0.25,
          pointRadius: 0,
          fill: true
        },
        {
          label: t("arena.adversary"),
          data: cumB,
          borderColor: "#ff6b35",
          backgroundColor: "rgba(255, 107, 53, 0.08)",
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
        x: {
          title: {
            display: true,
            text: t("playground.match.tours"),
            color: "#7d96a0",
            font: { family: "JetBrains Mono", size: 10, weight: "600" },
            padding: { top: 4 }
          },
          grid: { color: "rgba(255,255,255,0.04)" },
          ticks: {
            color: "#7d96a0",
            font: { family: "JetBrains Mono", size: 10 },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 12
          }
        },
        y: {
          title: {
            display: true,
            text: t("playground.results.score"),
            color: "#5fe3d8",
            font: { family: "JetBrains Mono", size: 10, weight: "700" },
            padding: { bottom: 6 }
          },
          grid: { color: "rgba(255,255,255,0.04)" },
          ticks: { color: "#7d96a0", font: { family: "JetBrains Mono", size: 10 } },
          beginAtZero: true
        }
      },
      plugins: {
        legend: {
          position: "right",
          align: "center",
          labels: {
            color: "#c5d4d9",
            font: { family: "Space Grotesk", size: 12 },
            usePointStyle: true,
            pointStyle: "circle",
            padding: 14,
            boxHeight: 8
          }
        },
        tooltip: {
          backgroundColor: "#0c1a1f",
          titleColor: "#fff",
          titleFont: { family: "Space Grotesk", size: 12, weight: "700" },
          bodyColor: "#c5d4d9",
          bodyFont: { family: "JetBrains Mono", size: 11 },
          borderColor: "#1d3a3f",
          borderWidth: 1,
          padding: 10,
          callbacks: {
            title: (items) => `${t("playground.match.tours")} ${items[0].label}`,
            label: (item) => ` ${item.dataset.label} : ${item.formattedValue}`
          }
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

// ---------- Details ----------
function renderDetails(result) {
  const ha = result.history_a;
  const hb = result.history_b;
  const nb = ha.length;
  const longest = longestRun(ha);
  const advantage = Math.abs(result.score_a - result.score_b);

  els.matchStats.innerHTML = `
    <div class="match-stat">
      <span class="match-stat-label">${t("arena.stat.duration")}</span>
      <span class="match-stat-value">${t("arena.stat.duration.value", { n: nb })}</span>
    </div>
    <div class="match-stat">
      <span class="match-stat-label">${t("arena.stat.advantage")}</span>
      <span class="match-stat-value">${advantage > 0 ? "+" + advantage : "0"}</span>
    </div>
    <div class="match-stat">
      <span class="match-stat-label">${t("arena.stat.longestC")}</span>
      <span class="match-stat-value">${longest.c}</span>
    </div>
    <div class="match-stat">
      <span class="match-stat-label">${t("arena.stat.longestD")}</span>
      <span class="match-stat-value">${longest.d}</span>
    </div>
  `;
}

// ---------- Analysis ----------
function renderAnalysis(result) {
  const analysis = pythonAnalyze(result.history_a, result.history_b);
  const profile = analysis.profile;
  let text;
  if (profile === "no_data") {
    text = t("playground.analysis.no_data");
  } else {
    text = t(`playground.analysis.profile.${profile}`);
  }
  els.quickAnalysisText.textContent = text;
  els.quickAnalysisText.classList.remove("placeholder");
  els.fullAnalysisText.textContent = text;
}

// ---------- Submit ----------
// ---------- Save (to /strategies) ----------
els.saveBtn.addEventListener("click", () => {
  if (!pyodide) return;
  els.saveName.value = activeStrategyName || "";
  els.saveDescription.value = "";
  openSimpleModal(els.saveModal);
});

els.saveConfirmBtn.addEventListener("click", async () => {
  const name = els.saveName.value.trim();
  if (!name) return;
  els.saveConfirmBtn.disabled = true;
  try {
    const code = editor.getValue();
    const validation = pyodide ? pythonValidate(code) : { ok: true, message: "" };
    const desc = els.saveDescription.value.trim();
    const strategiesRef = collection(db, "teams", context.uid, "strategies");

    if (activeStrategyId) {
      // Update existing
      const updateData = {
        name,
        code,
        validation_status: validation.ok ? "ok" : "error",
        validation_message: validation.message,
        updated_at: serverTimestamp()
      };
      if (desc) updateData.description = desc;
      await updateDoc(doc(strategiesRef, activeStrategyId), updateData);
      activeStrategyName = name;
      closeSimpleModal(els.saveModal);
      showValidationMsg(els.submitMsg,
        { ok: true, message: t("playground.save.update.success", { name }) });
    } else {
      const ref = await addDoc(strategiesRef, {
        name,
        description: desc,
        code,
        validation_status: validation.ok ? "ok" : "error",
        validation_message: validation.message,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
        last_submitted_at: null
      });
      activeStrategyId = ref.id;
      activeStrategyName = name;
      closeSimpleModal(els.saveModal);
      showValidationMsg(els.submitMsg,
        { ok: true, message: t("playground.save.success", { name }) });
    }
  } catch (err) {
    console.error(err);
    showValidationMsg(els.submitMsg, { ok: false, message: t("submit.error", { msg: err.message || err }) });
  } finally {
    els.saveConfirmBtn.disabled = false;
  }
});

// ---------- Submit to tournament (to /bots) ----------
els.submitBtn.addEventListener("click", async () => {
  if (!pyodide) return;
  // Reset modal to loading state
  els.submitChecking.hidden = false;
  els.submitBlocked.hidden = true;
  els.submitFormContent.hidden = true;
  els.submitConfirmBtn.disabled = true;
  openSimpleModal(els.submitModal);

  // Build list of eligible tournaments (registered + bot not yet submitted)
  let eligible;
  try {
    eligible = await getEligibleTournaments();
  } catch (err) {
    console.error(err);
    els.submitChecking.hidden = true;
    els.submitBlocked.hidden = false;
    els.submitBlockedMsg.textContent = t("submit.error", { msg: err.message || err });
    return;
  }

  if (eligible.length === 0) {
    els.submitChecking.hidden = true;
    els.submitBlocked.hidden = false;
    // Distinguish "no tournament at all" from "all tournaments already submitted"
    if (!context.tournamentId) {
      els.submitBlockedMsg.textContent = t("playground.submit.modal.no_tournament");
    } else {
      els.submitBlockedMsg.textContent = t("playground.submit.modal.already_submitted",
        { name: context.tournament?.name || "" });
    }
    return;
  }

  // Populate SELECT with eligible tournaments
  els.submitChecking.hidden = true;
  els.submitFormContent.hidden = false;
  els.submitTournament.innerHTML = eligible
    .map((tm) => `<option value="${escapeAttr(tm.id)}">${escapeHtml(tm.name)}</option>`)
    .join("");
  els.submitName.value = activeStrategyName || "";
  els.submitConfirmBtn.disabled = false;
});

// Build the list of tournaments the team is registered to. Resubmitting is
// allowed for any open tournament — the previously-submitted strategy will
// be unlocked at submit time by the strategies.js flow.
async function getEligibleTournaments() {
  if (!context.tournaments || context.tournaments.length === 0) return [];
  return context.tournaments
    .filter((tm) => (tm.status || "open_submission") === "open_submission")
    .map((tm) => ({ id: tm.id, name: tm.name }));
}

function escapeAttr(s) {
  return String(s).replace(/"/g, "&quot;");
}

els.submitConfirmBtn.addEventListener("click", async () => {
  if (!pyodide) return;
  const targetTournamentId = els.submitTournament.value || context.tournamentId;
  const targetTournamentName = els.submitTournament.options[els.submitTournament.selectedIndex]?.textContent || context.tournament?.name || "";
  if (!targetTournamentId) {
    showValidationMsg(els.submitMsg,
      { ok: false, message: t("playground.submit.modal.no_tournament") });
    closeSimpleModal(els.submitModal);
    return;
  }
  els.submitConfirmBtn.disabled = true;
  try {
    // Double-check race condition : someone else (e.g. teammate on another tab) just submitted
    const guardSnap = await getDoc(
      doc(db, "tournaments", targetTournamentId, "teams", context.uid)
    );
    if (guardSnap.exists() && guardSnap.data().bot_code) {
      closeSimpleModal(els.submitModal);
      showValidationMsg(els.submitMsg,
        { ok: false, message: t("playground.submit.modal.already_submitted", { name: targetTournamentName }) });
      return;
    }

    const code = editor.getValue();
    const validation = pythonValidate(code);
    const submissionName = els.submitName.value.trim() || activeStrategyName || "Untitled";
    const validationFields = {
      validation_status: validation.ok ? "ok" : "error",
      validation_message: validation.message
    };

    // Always mirror the submission into /strategies so the history is preserved.
    // We store only the tournament id; the name is looked up live from
    // /tournaments/{id} when rendering — avoids stale denormalized data.
    const submissionMeta = {
      last_submitted_at: serverTimestamp(),
      last_submitted_tournament_id: targetTournamentId
    };

    let strategyId = activeStrategyId;
    if (strategyId) {
      // Update existing strategy: code, validation, timestamps.
      await updateDoc(
        doc(db, "teams", context.uid, "strategies", strategyId),
        {
          code,
          ...validationFields,
          updated_at: serverTimestamp(),
          ...submissionMeta
        }
      );
    } else {
      // No active strategy yet → create one from this submission.
      const newStratRef = await addDoc(
        collection(db, "teams", context.uid, "strategies"),
        {
          name: submissionName,
          description: "",
          code,
          ...validationFields,
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
          ...submissionMeta
        }
      );
      strategyId = newStratRef.id;
      activeStrategyId = strategyId;
      activeStrategyName = submissionName;
    }

    // Submit by writing bot_* fields onto the team's participation doc
    await setDoc(
      doc(db, "tournaments", targetTournamentId, "teams", context.uid),
      {
        bot_code: code,
        bot_name: submissionName,
        bot_submitted_at: serverTimestamp(),
        bot_validation_status: validation.ok ? "ok" : "error",
        bot_validation_message: validation.message,
        bot_strategy_id: strategyId
      },
      { merge: true }
    );
    closeSimpleModal(els.submitModal);
    showValidationMsg(els.submitMsg,
      { ok: validation.ok, message: validation.ok
        ? t("playground.submit.success", { name: submissionName })
        : t("submit.invalid") + " " + validation.message });
  } catch (err) {
    console.error(err);
    showValidationMsg(els.submitMsg, { ok: false, message: t("submit.error", { msg: err.message || err }) });
  } finally {
    els.submitConfirmBtn.disabled = false;
  }
});

// Reuse the existing modal helpers from the docs/picker modals (see openModal/closeModal earlier)
function openSimpleModal(modal) {
  modal.hidden = false;
  modal.addEventListener("click", onSimpleBackdropClick);
}
function closeSimpleModal(modal) {
  modal.hidden = true;
  modal.removeEventListener("click", onSimpleBackdropClick);
}
function onSimpleBackdropClick(e) {
  if (e.target === e.currentTarget || e.target.dataset.modalClose !== undefined || e.target.classList.contains("modal-close")) {
    closeSimpleModal(e.currentTarget);
  }
}

function showValidationMsg(el, result, prefix = "") {
  el.hidden = false;
  el.classList.remove("ok", "ko");
  el.classList.add(result.ok ? "ok" : "ko");
  el.textContent = (prefix ? prefix + " " : "") + result.message;
}

// ---------- Lang change ----------
document.addEventListener("langchange", () => {
  setSaveState(!els.saveIndicator.classList.contains("unsaved"));
  if (activeStrategyLocked) applyLockedState();
  if (lastResult && lastOpponent) {
    renderMatch(lastResult, lastOpponent);
  }
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
