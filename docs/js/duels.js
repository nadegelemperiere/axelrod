// Team-side duel page. Flow:
//
//   1. Inviter picks opponent + match params (no strategy yet) → status="pending"
//   2. Invitee receives the invite, clicks Accept (one click) → status="accepted"
//      or Decline → status="declined"
//   3. While status="accepted", BOTH sides see a "Pick strategy" button.
//      Each side independently selects one of their saved strategies. The
//      doc fields inviter_strategy_* / invitee_strategy_* are filled as
//      each side picks.
//   4. When both _strategy_code fields are non-null, ANY browser viewing
//      the doc tries to claim the runner role via a Firestore transaction
//      that flips status="accepted" → "running". Only one transaction can
//      win; the winner loads Pyodide, runs the match, and writes the
//      result with status="completed".

import { initSidebar } from "./sidebar.js";
import { t } from "./i18n.js";
import { loadTeamContext } from "./team-context.js";
import { db } from "./firebase-config.js";
import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  getDocs,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

initSidebar("duels");

const els = {
  main: document.getElementById("main"),
  noTeam: document.getElementById("no-team"),
  openInviteBtn: document.getElementById("open-invite-btn"),
  tabs: document.querySelectorAll(".duels-tabs .tab-btn"),
  duelsList: document.getElementById("duels-list"),
  duelsEmpty: document.getElementById("duels-empty"),
  inboxBadge: document.getElementById("inbox-badge"),

  inviteModal: document.getElementById("invite-modal"),
  inviteOpponent: document.getElementById("invite-opponent"),
  inviteTurns: document.getElementById("invite-turns"),
  inviteNoise: document.getElementById("invite-noise"),
  inviteMsg: document.getElementById("invite-msg"),
  inviteSendBtn: document.getElementById("invite-send-btn"),

  pickModal: document.getElementById("pick-strategy-modal"),
  pickSummary: document.getElementById("pick-summary"),
  pickStrategySelect: document.getElementById("pick-strategy-select"),
  pickMsg: document.getElementById("pick-msg"),
  pickConfirmBtn: document.getElementById("pick-confirm-btn"),

  detailModal: document.getElementById("detail-modal"),
  detailBody: document.getElementById("detail-body")
};

let context = null;
const teams = new Map();         // uid -> {display_name, emoji, email}
const strategies = new Map();    // id -> {name, code, validation_status}
const duels = new Map();         // id -> doc data (with .id)
let activeTab = "inbox";
let pyodide = null;
let pyodideLoading = null;
let pendingPickDuelId = null;
const runAttempted = new Set();  // duelIds where we've already kicked off a run attempt this session

// ---------- Boot ----------
loadTeamContext({
  onLoaded: async (ctx) => {
    context = ctx;
    await Promise.all([loadAllTeams(), loadMyStrategies()]);
    populateInviteOpponentSelect();
    populatePickStrategySelect();
    subscribeDuels();
    els.main.hidden = false;
  },
  onNoTeam: () => {
    els.noTeam.hidden = false;
  }
});

async function loadAllTeams() {
  const snap = await getDocs(collection(db, "teams"));
  snap.forEach((d) => {
    if (d.id !== context.uid) teams.set(d.id, d.data());
  });
}

async function loadMyStrategies() {
  const snap = await getDocs(collection(db, "teams", context.uid, "strategies"));
  snap.forEach((d) => {
    const data = d.data();
    if (data.validation_status === "ok" && data.code) {
      strategies.set(d.id, data);
    }
  });
}

// ---------- Firestore listeners ----------
function subscribeDuels() {
  const sentQ = query(collection(db, "duels"), where("inviter_uid", "==", context.uid));
  const inboxQ = query(collection(db, "duels"), where("invitee_uid", "==", context.uid));
  onSnapshot(sentQ, applyDuelChanges);
  onSnapshot(inboxQ, applyDuelChanges);
}

function applyDuelChanges(snap) {
  const toAutoOpen = [];
  for (const change of snap.docChanges()) {
    if (change.type === "removed") {
      duels.delete(change.doc.id);
      runAttempted.delete(change.doc.id);
    } else {
      const oldD = duels.get(change.doc.id);
      const d = { id: change.doc.id, ...change.doc.data() };
      duels.set(change.doc.id, d);
      // Self-healing: any client viewing the doc with both codes ready tries
      // to claim the runner role. Only one transaction wins; the others
      // see status already changed and back off.
      maybeKickoffMatch(d);
      // Live notification: when a duel transitions from non-final to final
      // and I haven't seen it, surface the result modal automatically rather
      // than expecting the student to notice the badge and find the row.
      if (
        change.type === "modified" &&
        oldD &&
        !FINAL_STATUSES.includes(oldD.status) &&
        FINAL_STATUSES.includes(d.status) &&
        !mySeenFlag(d)
      ) {
        toAutoOpen.push(d);
      }
    }
  }
  renderDuelsList();
  refreshInboxBadge();
  // Only auto-open one modal (most recent) to avoid stacking if multiple
  // matches complete in the same snapshot batch.
  if (toAutoOpen.length > 0) {
    const last = toAutoOpen[toAutoOpen.length - 1];
    openDetailModal(last);
  }
}

function maybeKickoffMatch(d) {
  if (d.status !== "accepted") return;
  if (!d.inviter_strategy_code || !d.invitee_strategy_code) return;
  if (runAttempted.has(d.id)) return;
  runAttempted.add(d.id);
  tryRunMatch(d.id).catch((err) => {
    console.error("tryRunMatch failed", err);
    runAttempted.delete(d.id);
  });
}

function refreshInboxBadge() {
  const n = [...duels.values()].filter(isInbox).length;
  if (n > 0) {
    els.inboxBadge.textContent = n;
    els.inboxBadge.hidden = false;
  } else {
    els.inboxBadge.hidden = true;
  }
}

// ---------- Tab filtering ----------
// Inbox = something I need to look at right now:
//          - pending invitations to accept/decline
//          - accepted duels where I haven't picked my strategy yet
//          - finalized duels (completed/declined/error) I haven't viewed yet
// Sent  = waiting on someone else.
// History = finalized AND I've already seen the result.
const FINAL_STATUSES = ["completed", "declined", "error"];

function isInbox(d) {
  if (d.status === "pending" && d.invitee_uid === context.uid) return true;
  if (d.status === "accepted") return !myStrategyCode(d);
  if (FINAL_STATUSES.includes(d.status) && !mySeenFlag(d)) return true;
  return false;
}
function isSent(d) {
  if (d.status === "pending" && d.inviter_uid === context.uid) return true;
  if (d.status === "accepted" && myStrategyCode(d) && !theirStrategyCode(d)) return true;
  if (d.status === "running") return true;
  return false;
}
function isHistory(d) {
  return FINAL_STATUSES.includes(d.status) && mySeenFlag(d);
}

function iAmInviter(d) {
  return d.inviter_uid === context.uid;
}
function myStrategyCode(d) {
  return iAmInviter(d) ? d.inviter_strategy_code : d.invitee_strategy_code;
}
function theirStrategyCode(d) {
  return iAmInviter(d) ? d.invitee_strategy_code : d.inviter_strategy_code;
}
function mySeenFlag(d) {
  return iAmInviter(d) ? !!d.inviter_seen : !!d.invitee_seen;
}
function mySeenFieldName(d) {
  return iAmInviter(d) ? "inviter_seen" : "invitee_seen";
}

els.tabs.forEach((btn) => {
  btn.addEventListener("click", () => {
    activeTab = btn.dataset.filter;
    els.tabs.forEach((b) => b.classList.toggle("active", b === btn));
    renderDuelsList();
  });
});

// ---------- List rendering ----------
function renderDuelsList() {
  const filterFn = activeTab === "inbox" ? isInbox : activeTab === "sent" ? isSent : isHistory;
  const rows = [...duels.values()].filter(filterFn);
  rows.sort((a, b) => tsMs(b.created_at) - tsMs(a.created_at));

  if (rows.length === 0) {
    els.duelsList.innerHTML = "";
    els.duelsEmpty.hidden = false;
    return;
  }
  els.duelsEmpty.hidden = true;
  els.duelsList.innerHTML = "";
  for (const d of rows) {
    els.duelsList.appendChild(renderDuelRow(d));
  }
}

function tsMs(ts) {
  return ts?.toMillis?.() ?? 0;
}

function renderDuelRow(d) {
  const li = document.createElement("li");
  li.className = "duel-row";
  if (FINAL_STATUSES.includes(d.status) && !mySeenFlag(d)) {
    li.classList.add("duel-row-unseen");
  }
  const otherTeamName = iAmInviter(d) ? d.invitee_team_name : d.inviter_team_name;
  const myStrat = iAmInviter(d) ? d.inviter_strategy_name : d.invitee_strategy_name;
  const theirStrat = iAmInviter(d) ? d.invitee_strategy_name : d.inviter_strategy_name;

  const statusKey = effectiveStatusKey(d);
  const statusLabel = t(`duels.status.${statusKey}`);

  const stratsLine =
    myStrat || theirStrat
      ? `${escapeHtml(myStrat || t("duels.row.strategy_pending"))} ⚔ ${escapeHtml(theirStrat || t("duels.row.strategy_pending"))}`
      : t("duels.row.both_pending");

  const summary = `
    <div class="duel-row-main">
      <div class="duel-row-opponent">
        <span class="duel-row-vs" data-i18n="duels.row.vs">vs</span>
        <strong>${escapeHtml(otherTeamName || "?")}</strong>
      </div>
      <div class="duel-row-strats muted small">${stratsLine}</div>
      <div class="duel-row-meta muted small">
        ${formatTs(d.created_at)} · ${d.nb_turns} ${t("playground.match.tours")} · ${(d.noise_level * 100).toFixed(0)}% ${t("playground.noise.label").toLowerCase()}
      </div>
    </div>
    <span class="duel-status duel-status-${statusKey}">${escapeHtml(statusLabel)}</span>
  `;

  const actions = renderRowActions(d);
  li.innerHTML = `${summary}<div class="duel-row-actions">${actions}</div>`;
  attachRowHandlers(li, d);
  return li;
}

// Status key used for badge + label. Adds nuance over the raw status field
// for the "accepted" state, depending on how many sides have already picked.
function effectiveStatusKey(d) {
  if (d.status !== "accepted") return d.status;
  const mine = !!myStrategyCode(d);
  const theirs = !!theirStrategyCode(d);
  if (mine && theirs) return "running";
  if (mine && !theirs) return "waiting_opponent";
  if (!mine && theirs) return "your_turn";
  return "both_pick";
}

function renderRowActions(d) {
  if (d.status === "pending" && !iAmInviter(d)) {
    return `
      <button class="btn-accept" data-action="accept" data-i18n="duels.row.accept">Accept</button>
      <button class="btn-decline" data-action="decline" data-i18n="duels.row.decline">Decline</button>
    `;
  }
  if (d.status === "pending" && iAmInviter(d)) {
    return `<span class="muted small" data-i18n="duels.row.waiting">Waiting…</span>`;
  }
  if (d.status === "accepted") {
    const mine = !!myStrategyCode(d);
    if (!mine) {
      return `<button class="btn-accept" data-action="pick" data-i18n="duels.row.pick">Pick strategy</button>`;
    }
    return `<span class="muted small" data-i18n="duels.row.waiting_opponent">Waiting on opponent's strategy…</span>`;
  }
  if (d.status === "running") {
    return `<span class="muted small" data-i18n="duels.row.running">Running…</span>`;
  }
  if (d.status === "completed" && d.result) {
    const myScore = iAmInviter(d) ? d.result.score_a : d.result.score_b;
    const theirScore = iAmInviter(d) ? d.result.score_b : d.result.score_a;
    const outcome = myScore > theirScore ? "🏆" : myScore < theirScore ? "💀" : "🤝";
    const unseen = !mySeenFlag(d);
    const cta = unseen ? "duels.row.view_result" : "duels.row.view";
    const btnClass = unseen ? "btn-accept" : "btn-view";
    return `
      <span class="duel-row-score">${myScore} <span class="vs">vs</span> ${theirScore} ${outcome}</span>
      <button class="${btnClass}" data-action="view" data-i18n="${cta}">${unseen ? "View result" : "View"}</button>
    `;
  }
  if (d.status === "error" || d.status === "declined") {
    const unseen = !mySeenFlag(d);
    const cta = unseen ? "duels.row.view_result" : "duels.row.view";
    const btnClass = unseen ? "btn-accept" : "btn-view";
    return `<button class="${btnClass}" data-action="view" data-i18n="${cta}">${unseen ? "View result" : "View"}</button>`;
  }
  return "";
}

function attachRowHandlers(li, d) {
  li.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      if (action === "accept") acceptDuel(d);
      else if (action === "decline") declineDuel(d);
      else if (action === "pick") openPickModal(d);
      else if (action === "view") openDetailModal(d);
    });
  });
}

// ---------- Invite flow ----------
function populateInviteOpponentSelect() {
  const sorted = [...teams.entries()].sort((a, b) =>
    (a[1].display_name || "").localeCompare(b[1].display_name || "")
  );
  els.inviteOpponent.innerHTML = sorted
    .map(([uid, tm]) => `<option value="${escapeAttr(uid)}">${escapeHtml(tm.display_name || uid)}</option>`)
    .join("");
}

function populatePickStrategySelect() {
  const opts = [...strategies.entries()]
    .map(([id, s]) => `<option value="${escapeAttr(id)}">${escapeHtml(s.name)}</option>`)
    .join("");
  const empty = `<option value="" disabled selected>${escapeHtml(t("duels.invite.no_strategy"))}</option>`;
  els.pickStrategySelect.innerHTML = strategies.size === 0 ? empty : opts;
}

els.openInviteBtn.addEventListener("click", () => {
  if (teams.size === 0) {
    alert(t("duels.invite.no_team"));
    return;
  }
  els.inviteMsg.hidden = true;
  openModal(els.inviteModal);
});

els.inviteSendBtn.addEventListener("click", async () => {
  const opponentUid = els.inviteOpponent.value;
  const turns = parseInt(els.inviteTurns.value, 10);
  const noisePct = parseInt(els.inviteNoise.value, 10) || 0;
  if (!opponentUid || !turns || turns < 5) {
    showMsg(els.inviteMsg, false, t("duels.invite.invalid"));
    return;
  }
  const opponent = teams.get(opponentUid);
  if (!opponent) {
    showMsg(els.inviteMsg, false, t("duels.invite.invalid"));
    return;
  }
  els.inviteSendBtn.disabled = true;
  try {
    await addDoc(collection(db, "duels"), {
      inviter_uid: context.uid,
      inviter_team_name: context.team.display_name || "",
      inviter_strategy_id: null,
      inviter_strategy_name: null,
      inviter_strategy_code: null,
      invitee_uid: opponentUid,
      invitee_team_name: opponent.display_name || "",
      invitee_strategy_id: null,
      invitee_strategy_name: null,
      invitee_strategy_code: null,
      nb_turns: turns,
      noise_level: Math.max(0, Math.min(0.3, noisePct / 100)),
      status: "pending",
      created_at: serverTimestamp(),
      responded_at: null,
      completed_at: null,
      result: null,
      error: null
    });
    closeModal(els.inviteModal);
  } catch (err) {
    console.error(err);
    showMsg(els.inviteMsg, false, t("duels.invite.error", { msg: err.message || err }));
  } finally {
    els.inviteSendBtn.disabled = false;
  }
});

// ---------- Accept / Decline ----------
async function acceptDuel(d) {
  if (!confirm(t("duels.accept.confirm_text", {
    team: d.inviter_team_name,
    turns: d.nb_turns,
    noise: Math.round((d.noise_level || 0) * 100)
  }))) return;
  try {
    await updateDoc(doc(db, "duels", d.id), {
      status: "accepted",
      responded_at: serverTimestamp()
    });
  } catch (err) {
    console.error(err);
    alert(t("duels.accept.error", { msg: err.message || err }));
  }
}

async function declineDuel(d) {
  if (!confirm(t("duels.decline.confirm", { team: d.inviter_team_name }))) return;
  try {
    // The invitee just declined — they don't need a "you have unread result"
    // notification for their own action. The inviter does (invitee_seen=true,
    // inviter_seen stays unset and falsy → notification on their side).
    await updateDoc(doc(db, "duels", d.id), {
      status: "declined",
      invitee_seen: true,
      responded_at: serverTimestamp()
    });
  } catch (err) {
    console.error(err);
    alert(t("duels.decline.error", { msg: err.message || err }));
  }
}

// ---------- Pick strategy ----------
function openPickModal(d) {
  if (strategies.size === 0) {
    alert(t("duels.invite.no_strategy"));
    return;
  }
  pendingPickDuelId = d.id;
  const otherTeam = iAmInviter(d) ? d.invitee_team_name : d.inviter_team_name;
  els.pickSummary.textContent = t("duels.pick.summary", {
    team: otherTeam,
    turns: d.nb_turns,
    noise: Math.round((d.noise_level || 0) * 100)
  });
  els.pickMsg.hidden = true;
  els.pickConfirmBtn.disabled = false;
  openModal(els.pickModal);
}

els.pickConfirmBtn.addEventListener("click", async () => {
  const duel = duels.get(pendingPickDuelId);
  if (!duel) return;
  const strategyId = els.pickStrategySelect.value;
  const strat = strategies.get(strategyId);
  if (!strat) {
    showMsg(els.pickMsg, false, t("duels.invite.invalid"));
    return;
  }
  els.pickConfirmBtn.disabled = true;
  try {
    const fields = iAmInviter(duel)
      ? {
          inviter_strategy_id: strategyId,
          inviter_strategy_name: strat.name,
          inviter_strategy_code: strat.code
        }
      : {
          invitee_strategy_id: strategyId,
          invitee_strategy_name: strat.name,
          invitee_strategy_code: strat.code
        };
    await updateDoc(doc(db, "duels", duel.id), fields);
    closeModal(els.pickModal);
    // Don't kick off the match here — applyDuelChanges() will see the update
    // and call maybeKickoffMatch() once the local snapshot includes both
    // codes (could be after the opponent's pick).
  } catch (err) {
    console.error(err);
    showMsg(els.pickMsg, false, t("duels.pick.error", { msg: err.message || err }));
    els.pickConfirmBtn.disabled = false;
  }
});

// ---------- Match runner (transaction-claimed) ----------
async function tryRunMatch(duelId) {
  const duelRef = doc(db, "duels", duelId);
  let claim = null;
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(duelRef);
    if (!snap.exists()) return;
    const d = snap.data();
    if (d.status !== "accepted") return;
    if (!d.inviter_strategy_code || !d.invitee_strategy_code) return;
    tx.update(duelRef, { status: "running" });
    claim = {
      codeA: d.inviter_strategy_code,
      codeB: d.invitee_strategy_code,
      nbTurns: d.nb_turns,
      noise: d.noise_level || 0
    };
  });
  if (!claim) return; // someone else became the runner, or state regressed

  try {
    await ensurePyodide();
    const result = runDuelMatch(claim.codeA, claim.codeB, claim.nbTurns, claim.noise);
    if (!result.ok) {
      await updateDoc(duelRef, {
        status: "error",
        error: result.error || "Match failed",
        completed_at: serverTimestamp()
      });
    } else {
      const persisted = {
        score_a: result.score_a,
        score_b: result.score_b,
        history_a: result.history_a,
        history_b: result.history_b,
        nb_turns: result.nb_turns,
        noise_level: result.noise_level
      };
      if (result.forfeit) persisted.forfeit = result.forfeit;
      if (result.error_a) persisted.error_a = result.error_a;
      if (result.error_b) persisted.error_b = result.error_b;
      await updateDoc(duelRef, {
        status: "completed",
        result: persisted,
        completed_at: serverTimestamp()
      });
    }
  } catch (err) {
    console.error(err);
    await updateDoc(duelRef, {
      status: "error",
      error: err.message || String(err),
      completed_at: serverTimestamp()
    });
  }
}

// ---------- Pyodide ----------
async function ensurePyodide() {
  if (pyodide) return;
  if (pyodideLoading) return pyodideLoading;
  pyodideLoading = (async () => {
    const { loadPyodide } = await import("https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.mjs");
    pyodide = await loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/" });
    const sandboxCode = await fetch("./sandbox.py").then((r) => r.text());
    pyodide.runPython(sandboxCode);
  })();
  return pyodideLoading;
}

function runDuelMatch(codeA, codeB, nbTurns, noise) {
  pyodide.globals.set("_code_a", codeA);
  pyodide.globals.set("_code_b", codeB);
  pyodide.globals.set("_nb", nbTurns);
  pyodide.globals.set("_noise", noise);
  pyodide.globals.set("_seed", null);
  const proxy = pyodide.runPython("run_tournament_match(_code_a, _code_b, _nb, _noise, _seed)");
  const result = proxy.toJs({ dict_converter: Object.fromEntries });
  proxy.destroy();
  return result;
}

// ---------- Detail modal ----------
function openDetailModal(d) {
  // Mark as seen on my side if this is a finalized duel I hadn't viewed yet.
  // Fire-and-forget; the snapshot listener will refresh the list ordering.
  if (FINAL_STATUSES.includes(d.status) && !mySeenFlag(d)) {
    updateDoc(doc(db, "duels", d.id), { [mySeenFieldName(d)]: true })
      .catch((err) => console.warn("Could not mark duel as seen", err));
  }
  const r = d.result || {};
  const myName = iAmInviter(d) ? d.inviter_strategy_name : d.invitee_strategy_name;
  const theirName = iAmInviter(d) ? d.invitee_strategy_name : d.inviter_strategy_name;
  const myScore = iAmInviter(d) ? r.score_a : r.score_b;
  const theirScore = iAmInviter(d) ? r.score_b : r.score_a;
  const myHistory = iAmInviter(d) ? r.history_a || "" : r.history_b || "";
  const theirHistory = iAmInviter(d) ? r.history_b || "" : r.history_a || "";

  if (d.status === "error") {
    els.detailBody.innerHTML = `<p class="error">${escapeHtml(d.error || "Match failed")}</p>`;
  } else if (d.status === "declined") {
    els.detailBody.innerHTML = `<p class="muted">${escapeHtml(t("duels.detail.declined"))}</p>`;
  } else {
    els.detailBody.innerHTML = `
      <div class="duel-detail-head">
        <div><strong>${escapeHtml(myName || "?")}</strong> ${myScore}</div>
        <div class="muted small">vs</div>
        <div><strong>${escapeHtml(theirName || "?")}</strong> ${theirScore}</div>
      </div>
      <div class="match-row">
        <span class="match-row-label">${escapeHtml(t("playground.match.row.opp"))}</span>
        <div class="match-cells">${renderCells(theirHistory)}</div>
      </div>
      <div class="match-row">
        <span class="match-row-label">${escapeHtml(t("playground.match.row.you"))}</span>
        <div class="match-cells">${renderCells(myHistory)}</div>
      </div>
    `;
  }
  openModal(els.detailModal);
}

function renderCells(str) {
  let out = "";
  for (const c of str) {
    out += `<span class="cell ${c === "C" ? "c" : "d"}">${c}</span>`;
  }
  return out;
}

// ---------- Generic modal + utility ----------
function openModal(modal) {
  modal.hidden = false;
  modal.addEventListener("click", onBackdropClick);
}
function closeModal(modal) {
  modal.hidden = true;
  modal.removeEventListener("click", onBackdropClick);
}
function onBackdropClick(e) {
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

function showMsg(el, ok, msg) {
  el.hidden = false;
  el.classList.remove("ok", "ko");
  el.classList.add(ok ? "ok" : "ko");
  el.textContent = msg;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function escapeAttr(s) {
  return String(s).replace(/"/g, "&quot;");
}

function formatTs(ts) {
  const ms = tsMs(ts);
  if (!ms) return "";
  const date = new Date(ms);
  return date.toLocaleString();
}

document.addEventListener("langchange", () => {
  renderDuelsList();
});
