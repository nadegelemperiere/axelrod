// Hot-seat mode: two players take turns on the same PC. The tree is shown
// at all times — what differs between sub-stages is which rows are
// "pending" (masked, '?' placeholders), "active" (currently being decided,
// highlighted), or "done" (revealed). This lets students see the full data
// flow from history → call → return → payoff → update on every screen,
// and watch the cursor move down the tree as the round progresses.

import { initSidebar } from "./sidebar.js";
import { t } from "./i18n.js";

initSidebar("hotseat");

const PAYOFF = {
  CC: [3, 3],
  CD: [0, 5],
  DC: [5, 0],
  DD: [1, 1]
};

const els = {
  // Stages
  setupStage: document.getElementById("stage-setup"),
  treeStage: document.getElementById("stage-tree"),
  endStage: document.getElementById("stage-end"),

  // Setup
  setupPlayerA: document.getElementById("setup-player-a"),
  setupPlayerB: document.getElementById("setup-player-b"),
  setupTurns: document.getElementById("setup-turns"),
  setupNoise: document.getElementById("setup-noise"),
  setupStartBtn: document.getElementById("setup-start-btn"),

  // Tree header
  treeRound: document.getElementById("tree-round"),
  treeTotal: document.getElementById("tree-total"),
  bannerIcon: document.getElementById("tree-banner-icon"),
  bannerText: document.getElementById("tree-banner-text"),
  banner: document.getElementById("tree-banner"),

  // Tree rows (for state class swapping)
  rowMy: document.getElementById("tree-row-my"),
  rowOpp: document.getElementById("tree-row-opp"),
  rowCall: document.getElementById("tree-row-call"),
  rowPickA: document.getElementById("tree-row-pick-a"),
  rowPickB: document.getElementById("tree-row-pick-b"),
  rowPayoff: document.getElementById("tree-row-payoff"),
  rowUpdate: document.getElementById("tree-row-update"),

  // Inputs section
  cellsMine: document.getElementById("tree-cells-mine"),
  cellsOpp: document.getElementById("tree-cells-opp"),
  pylistMine: document.getElementById("tree-pylist-mine"),
  pylistOpp: document.getElementById("tree-pylist-opp"),

  // Pick rows
  aName: document.getElementById("tree-a-name"),
  bName: document.getElementById("tree-b-name"),
  aMove: document.getElementById("tree-a-move"),
  bMove: document.getElementById("tree-b-move"),
  aReturn: document.getElementById("tree-a-return"),
  bReturn: document.getElementById("tree-b-return"),
  aActions: document.getElementById("tree-a-actions"),
  bActions: document.getElementById("tree-b-actions"),

  // Noise + payoff + update
  noiseLine: document.getElementById("tree-noise-line"),
  payoffAName: document.getElementById("tree-payoff-a-name"),
  payoffAValue: document.getElementById("tree-payoff-a-value"),
  payoffBName: document.getElementById("tree-payoff-b-name"),
  payoffBValue: document.getElementById("tree-payoff-b-value"),
  payoffCall: document.getElementById("tree-payoff-call"),

  updateAName: document.getElementById("tree-update-a-name"),
  updateBName: document.getElementById("tree-update-b-name"),
  updateCellsA: document.getElementById("tree-update-cells-a"),
  updateCellsB: document.getElementById("tree-update-cells-b"),
  updatePylistA: document.getElementById("tree-update-pylist-a"),
  updatePylistB: document.getElementById("tree-update-pylist-b"),

  // Scoreboard + next button
  totalA: document.getElementById("tree-total-a"),
  totalB: document.getElementById("tree-total-b"),
  nextActions: document.getElementById("tree-next-actions"),
  nextBtn: document.getElementById("tree-next-btn"),

  // End stage
  endAName: document.getElementById("end-a-name"),
  endBName: document.getElementById("end-b-name"),
  endAScore: document.getElementById("end-a-score"),
  endBScore: document.getElementById("end-b-score"),
  endOutcome: document.getElementById("end-outcome"),
  endHistoryA: document.getElementById("end-history-a"),
  endHistoryB: document.getElementById("end-history-b"),
  endARowLabel: document.getElementById("end-a-row-label"),
  endBRowLabel: document.getElementById("end-b-row-label"),
  endReplayBtn: document.getElementById("end-replay-btn"),
  endNewBtn: document.getElementById("end-new-btn")
};

const STAGES = [els.setupStage, els.treeStage, els.endStage];

function showStage(stage) {
  STAGES.forEach((s) => { s.hidden = s !== stage; });
}

// ---------- State ----------
let nameA = "Player 1";
let nameB = "Player 2";
let nbTurns = 10;
let noiseLevel = 0;
const historyA = [];
const historyB = [];
const intendedA = [];
const intendedB = [];
let scoreA = 0;
let scoreB = 0;
let round = 0;
let activeSide = "A";    // "A" or "B" — who is currently picking
let pendingA = null;
let pendingB = null;
let subStage = "picking_a"; // "picking_a" | "picking_b" | "reveal"

// ---------- Row state helpers ----------
// Three states per row: "pending" (masked / dim), "active" (highlighted,
// glow), "done" (revealed normally). Setting a class swaps the look in CSS.
function setRowState(row, state) {
  row.classList.remove("row-pending", "row-active", "row-done");
  row.classList.add(`row-${state}`);
}

// ---------- Setup ----------
els.setupStartBtn.addEventListener("click", startMatch);

function startMatch() {
  nameA = (els.setupPlayerA.value || "Player 1").trim().slice(0, 20) || "Player 1";
  nameB = (els.setupPlayerB.value || "Player 2").trim().slice(0, 20) || "Player 2";
  nbTurns = clampInt(els.setupTurns.value, 3, 50, 10);
  noiseLevel = clampInt(els.setupNoise.value, 0, 30, 0) / 100;
  historyA.length = 0; historyB.length = 0;
  intendedA.length = 0; intendedB.length = 0;
  scoreA = 0; scoreB = 0;
  round = 1;
  activeSide = "A";
  pendingA = null; pendingB = null;
  els.treeTotal.textContent = String(nbTurns);
  els.aName.textContent = nameA;
  els.bName.textContent = nameB;
  els.payoffAName.textContent = nameA;
  els.payoffBName.textContent = nameB;
  els.updateAName.textContent = nameA;
  els.updateBName.textContent = nameB;
  els.totalA.textContent = String(scoreA);
  els.totalB.textContent = String(scoreB);
  subStage = "picking_a";
  enterTree();
}

function clampInt(raw, lo, hi, fallback) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

// ---------- Tree stage ----------
function enterTree() {
  els.treeRound.textContent = String(round);
  // Banner: explicit "pass the PC" message during pick phases, plus an
  // emoji that visually distinguishes "your turn" / "reveal".
  els.banner.classList.remove("banner-pick", "banner-reveal");
  if (subStage === "picking_a") {
    els.bannerIcon.textContent = "🤝";
    els.bannerText.textContent = t("hotseat.banner.turn", { name: nameA });
    els.banner.classList.add("banner-pick");
  } else if (subStage === "picking_b") {
    els.bannerIcon.textContent = "🤝";
    els.bannerText.textContent = t("hotseat.banner.turn", { name: nameB });
    els.banner.classList.add("banner-pick");
  } else {
    els.bannerIcon.textContent = "🎲";
    els.bannerText.textContent = t("hotseat.banner.reveal");
    els.banner.classList.add("banner-reveal");
  }

  // Inputs always reflect the CURRENT picker's perspective (their own
  // history on top as `my_history`). On reveal we keep the last picker's
  // (B) perspective — the history-update row below shows both anyway.
  const myHist = activeSide === "A" ? historyA : historyB;
  const oppHist = activeSide === "A" ? historyB : historyA;
  renderCells(els.cellsMine, myHist);
  renderCells(els.cellsOpp, oppHist);
  els.pylistMine.textContent = "my_history = " + pythonRepr(myHist);
  els.pylistOpp.textContent = "opp_history = " + pythonRepr(oppHist);

  // Inputs and call row are always "done" — they're known the moment the
  // round starts. The decision and downstream rows toggle states.
  setRowState(els.rowMy, "done");
  setRowState(els.rowOpp, "done");
  setRowState(els.rowCall, "done");

  if (subStage === "picking_a") {
    // A's pick row is the live one. B's pick row + everything after are pending.
    setRowState(els.rowPickA, "active");
    setRowState(els.rowPickB, "pending");
    setRowState(els.rowPayoff, "pending");
    setRowState(els.rowUpdate, "pending");
    showButtonsFor("A");
    resetDecisionDisplays();
    els.nextActions.hidden = true;
  } else if (subStage === "picking_b") {
    // A's pick is recorded but still secret (A's row stays pending too).
    // We could mark A's row as "done-but-hidden" but pending is simpler and
    // keeps B from inferring anything.
    setRowState(els.rowPickA, "pending");
    setRowState(els.rowPickB, "active");
    setRowState(els.rowPayoff, "pending");
    setRowState(els.rowUpdate, "pending");
    showButtonsFor("B");
    resetDecisionDisplays();
    els.nextActions.hidden = true;
  } else {
    // Reveal: everything done.
    setRowState(els.rowPickA, "done");
    setRowState(els.rowPickB, "done");
    setRowState(els.rowPayoff, "done");
    setRowState(els.rowUpdate, "done");
    hideAllButtons();
    els.nextActions.hidden = false;
  }

  showStage(els.treeStage);
}

function showButtonsFor(side) {
  els.aActions.hidden = side !== "A";
  els.bActions.hidden = side !== "B";
}

function hideAllButtons() {
  els.aActions.hidden = true;
  els.bActions.hidden = true;
}

// Reset the decision-row displays back to '?' placeholders for the start of
// a new round (or while picks are still pending).
function resetDecisionDisplays() {
  els.aMove.textContent = "?";
  els.bMove.textContent = "?";
  els.aMove.className = "tree-node-move";
  els.bMove.className = "tree-node-move";
  els.aReturn.textContent = "'?'";
  els.bReturn.textContent = "'?'";
  els.payoffAValue.textContent = "+?";
  els.payoffBValue.textContent = "+?";
  els.payoffCall.textContent = "PAYOFF[('?','?')] = (?, ?)";
  els.updateCellsA.innerHTML = "";
  els.updateCellsB.innerHTML = "";
  els.updatePylistA.textContent = "history_a = ...";
  els.updatePylistB.textContent = "history_b = ...";
  els.noiseLine.hidden = true;
}

// ---------- Pick buttons ----------
els.treeStage.querySelectorAll(".hotseat-choice").forEach((btn) => {
  btn.addEventListener("click", () => {
    const side = btn.dataset.side;
    const move = btn.dataset.pick;
    if (side === "A" && subStage === "picking_a") onPickA(move);
    else if (side === "B" && subStage === "picking_b") onPickB(move);
  });
});

function onPickA(move) {
  pendingA = move;
  activeSide = "B";
  subStage = "picking_b";
  enterTree();
}

function onPickB(move) {
  pendingB = move;
  resolveRound();
}

// ---------- Resolve the round (both players have picked) ----------
function resolveRound() {
  intendedA.push(pendingA);
  intendedB.push(pendingB);
  const actualA = noiseLevel > 0 && Math.random() < noiseLevel ? flip(pendingA) : pendingA;
  const actualB = noiseLevel > 0 && Math.random() < noiseLevel ? flip(pendingB) : pendingB;
  historyA.push(actualA);
  historyB.push(actualB);
  const [payA, payB] = PAYOFF[actualA + actualB];
  scoreA += payA;
  scoreB += payB;

  // Populate the decision rows : the intended (pre-noise) pick is what
  // `play()` returned — noise happens AFTER the return on the wire.
  els.aMove.textContent = pendingA;
  els.bMove.textContent = pendingB;
  els.aMove.className = `tree-node-move ${pendingA === "C" ? "c" : "d"}`;
  els.bMove.className = `tree-node-move ${pendingB === "C" ? "c" : "d"}`;
  els.aReturn.textContent = `'${pendingA}'`;
  els.bReturn.textContent = `'${pendingB}'`;

  // Noise notice if anything got flipped.
  const flips = [];
  if (pendingA !== actualA) flips.push(`${nameA} (${pendingA} → ${actualA})`);
  if (pendingB !== actualB) flips.push(`${nameB} (${pendingB} → ${actualB})`);
  if (flips.length > 0) {
    els.noiseLine.textContent = t("hotseat.reveal.noise", { sides: flips.join(", ") });
    els.noiseLine.hidden = false;
  } else {
    els.noiseLine.hidden = true;
  }

  els.payoffAValue.textContent = `+${payA}`;
  els.payoffBValue.textContent = `+${payB}`;
  els.payoffCall.textContent = `PAYOFF[('${actualA}', '${actualB}')] = (${payA}, ${payB})`;

  renderCells(els.updateCellsA, historyA);
  renderCells(els.updateCellsB, historyB);
  els.updatePylistA.textContent = `history_a = ${pythonRepr(historyA)}`;
  els.updatePylistB.textContent = `history_b = ${pythonRepr(historyB)}`;

  els.totalA.textContent = String(scoreA);
  els.totalB.textContent = String(scoreB);

  // Round-local state reset (active side flips back to A at next-round click).
  pendingA = null; pendingB = null;

  subStage = "reveal";
  enterTree();
}

// ---------- Next round ----------
els.nextBtn.addEventListener("click", () => {
  if (round >= nbTurns) {
    enterEnd();
  } else {
    round++;
    activeSide = "A";
    subStage = "picking_a";
    enterTree();
  }
});

// ---------- Cells & utils ----------
function renderCells(container, arr) {
  container.innerHTML = "";
  if (arr.length === 0) {
    const placeholder = document.createElement("span");
    placeholder.className = "tree-cells-empty muted small";
    placeholder.textContent = t("hotseat.tree.empty");
    container.appendChild(placeholder);
    return;
  }
  for (const c of arr) {
    const cell = document.createElement("span");
    cell.className = `cell ${c === "C" ? "c" : "d"}`;
    cell.textContent = c;
    container.appendChild(cell);
  }
}

function pythonRepr(arr) {
  if (arr.length === 0) return "[]";
  return "[" + arr.map((c) => `'${c}'`).join(", ") + "]";
}

function flip(m) { return m === "C" ? "D" : "C"; }

// ---------- End ----------
function enterEnd() {
  els.endAName.textContent = nameA;
  els.endBName.textContent = nameB;
  els.endARowLabel.textContent = nameA;
  els.endBRowLabel.textContent = nameB;
  els.endAScore.textContent = String(scoreA);
  els.endBScore.textContent = String(scoreB);
  const outcome = scoreA > scoreB ? "win_a" : scoreB > scoreA ? "win_b" : "tie";
  els.endOutcome.textContent =
    outcome === "win_a" ? `🏆 ${nameA}`
    : outcome === "win_b" ? `🏆 ${nameB}`
    : `🤝 ${t("hotseat.end.tie")}`;
  renderCells(els.endHistoryA, historyA);
  renderCells(els.endHistoryB, historyB);
  showStage(els.endStage);
}

els.endReplayBtn.addEventListener("click", () => {
  historyA.length = 0; historyB.length = 0;
  intendedA.length = 0; intendedB.length = 0;
  scoreA = 0; scoreB = 0;
  round = 1;
  activeSide = "A";
  pendingA = null; pendingB = null;
  els.totalA.textContent = String(scoreA);
  els.totalB.textContent = String(scoreB);
  subStage = "picking_a";
  enterTree();
});

els.endNewBtn.addEventListener("click", () => {
  showStage(els.setupStage);
});

document.addEventListener("langchange", () => {
  // Re-render the tree on language change so labels (status header,
  // empty-history placeholder) pick up the new locale.
  if (!els.treeStage.hidden) enterTree();
});
