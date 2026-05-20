import { onAuth, isUserAdmin } from "./auth.js";
import { initSidebar } from "./sidebar.js";
import { t, tournamentStatusLabel } from "./i18n.js";
import { db } from "./firebase-config.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

initSidebar("admin-tournaments");

const els = {
  accessDenied: document.getElementById("access-denied"),
  main: document.getElementById("main"),
  tTitle: document.getElementById("t-title"),
  tPhase: document.getElementById("t-phase"),
  tStatus: document.getElementById("t-status"),
  tMeta: document.getElementById("t-meta"),
  tHeroCount: document.getElementById("t-hero-count"),
  tHeroDonutArc: document.getElementById("t-hero-donut-arc"),

  launchBtn: document.getElementById("launch-btn"),
  launchMsg: document.getElementById("launch-msg"),
  runBtn: document.getElementById("run-matches-btn"),
  runCancelBtn: document.getElementById("run-cancel-btn"),
  runMsg: document.getElementById("run-msg"),
  runProgress: document.getElementById("run-progress"),
  runProgressLabel: document.getElementById("run-progress-label"),
  runProgressBar: document.getElementById("run-progress-bar"),

  // Stat tiles
  statTeams: document.getElementById("stat-teams"),
  statTeamsSub: document.getElementById("stat-teams-sub"),
  statBots: document.getElementById("stat-bots"),
  statBotsSub: document.getElementById("stat-bots-sub"),
  statValid: document.getElementById("stat-valid"),
  statValidSub: document.getElementById("stat-valid-sub"),
  statIssues: document.getElementById("stat-issues"),
  statPending: document.getElementById("stat-pending"),

  // Teams list
  teamsCount: document.getElementById("t-teams-count"),
  teamsList: document.getElementById("teams-list"),
  teamsEmpty: document.getElementById("teams-empty"),
  teamsSearch: document.getElementById("t-teams-search"),

  // Sidebar
  flowSteps: document.getElementById("t-flow-steps"),
  settingsList: document.getElementById("t-settings-list"),

  // Modals
  openAddBtn: document.getElementById("open-add-btn"),
  addModal: document.getElementById("add-modal"),
  addForm: document.getElementById("add-form"),
  addBtn: document.getElementById("add-btn"),
  addMsg: document.getElementById("add-msg"),
  addEmptyHint: document.getElementById("add-empty-hint"),
  pick: document.getElementById("t-pick"),

  botModal: document.getElementById("bot-modal"),
  botModalTitle: document.getElementById("bot-modal-title"),
  botModalStatus: document.getElementById("bot-modal-status"),
  botModalSubmitted: document.getElementById("bot-modal-submitted"),
  botModalValidation: document.getElementById("bot-modal-validation"),
  botModalCode: document.getElementById("bot-modal-code"),

  launchModal: document.getElementById("launch-modal"),
  launchModalReady: document.getElementById("launch-modal-ready"),
  launchModalMissingIntro: document.getElementById("launch-modal-missing-intro"),
  launchModalMissingList: document.getElementById("launch-modal-missing-list"),
  launchConfirmCheck: document.getElementById("launch-confirm-check"),
  launchConfirmBtn: document.getElementById("launch-confirm-btn"),

};

// Latest bot data per team for inspection modal: { teamId: botData }
const latestBotByTeam = {};
// Teams in the tournament without a submitted bot.
let teamsWithoutBot = [];
// All registered teams enriched with team identity + bot data.
let teamsData = [];

let pyodide = null;

const params = new URLSearchParams(window.location.search);
const tournamentId = params.get("t");

if (!tournamentId) {
  alert(t("teams.alert.no.tid"));
  window.location.href = "admin.html";
}


let tournamentData = null;
let isAdmin = false;

onAuth(async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }
  isAdmin = await isUserAdmin(user.uid);
  // Apply role classes so CSS can hide admin-only / team-only controls.
  document.body.classList.toggle("is-admin", isAdmin);
  document.body.classList.toggle("is-team", !isAdmin);

  const tSnap = await getDoc(doc(db, "tournaments", tournamentId));
  if (!tSnap.exists()) {
    alert(t("teams.alert.not.found"));
    window.location.href = isAdmin ? "admin.html" : "tournaments.html";
    return;
  }
  tournamentData = tSnap.data();
  // Completed tournaments → redirect to analysis (works for both roles).
  if (tournamentData.status === "completed") {
    window.location.href = `tournament-view.html?t=${encodeURIComponent(tournamentId)}`;
    return;
  }
  els.main.hidden = false;
  await Promise.all([refreshAvailable(), refreshTeams()]);
  renderHero();
  renderFlow();
  renderSettings();
  updateStatusUI();
});

// ---------- Hero header ----------
function renderHero() {
  if (!tournamentData) return;
  els.tTitle.textContent = tournamentData.name;
  els.tPhase.textContent = t("tournament.hero.phase", { n: tournamentData.phase || 1 });
  const status = tournamentData.status || "open_submission";
  els.tStatus.textContent = tournamentStatusLabel(status).toUpperCase();
  els.tStatus.className = "badge t-hero-status " + statusBadgeClass(status);
  els.tMeta.textContent = isAdmin
    ? t("tournament.hero.params", {
        turns: tournamentData.nb_turns,
        noise: (tournamentData.noise_level * 100).toFixed(0)
      })
    : t("tournament.hero.params.team", {
        noise: (tournamentData.noise_level * 100).toFixed(0)
      });
}

function statusBadgeClass(s) {
  if (s === "running") return "live";
  if (s === "completed") return "ok";
  return "warn";
}

// Donut shows tournament readiness : number of teams with a validated bot
// over total registered teams. Arc full ⇒ ready to launch.
function renderHeroDonut(ready, total) {
  els.tHeroCount.textContent = `${ready}/${total}`;
  const fraction = total > 0 ? Math.min(1, ready / total) : 0;
  const circumference = 2 * Math.PI * 48;
  const dash = fraction * circumference;
  els.tHeroDonutArc.setAttribute("stroke-dasharray", `${dash} ${circumference - dash}`);
}

// ---------- Tournament flow stepper ----------
function renderFlow() {
  const status = tournamentData?.status || "open_submission";
  const steps = [
    { key: "open_submission", icon: "🔓", label: t("tournament.flow.open"), sub: t("tournament.flow.open.sub") },
    { key: "running", icon: "▶", label: t("tournament.flow.running"), sub: t("tournament.flow.running.sub") },
    { key: "completed", icon: "🏆", label: t("tournament.flow.completed"), sub: t("tournament.flow.completed.sub") }
  ];
  const order = ["open_submission", "running", "completed"];
  const idx = order.indexOf(status);
  els.flowSteps.innerHTML = steps.map((s, i) => {
    const cls = i < idx ? "done" : i === idx ? "current" : "pending";
    return `
      <li class="t-flow-step ${cls}">
        <span class="t-flow-icon">${s.icon}</span>
        <div class="t-flow-body">
          <div class="t-flow-label">${escapeHtml(s.label)}</div>
          <div class="t-flow-sub muted small">${escapeHtml(s.sub)}</div>
        </div>
      </li>
    `;
  }).join("");
}

// ---------- Settings sidebar ----------
function renderSettings() {
  if (!tournamentData) return;
  const locale = document.documentElement.lang === "fr" ? "fr-FR" : "en-GB";
  const fmt = (ts) => ts?.toDate?.()?.toLocaleString(locale) || "—";
  const rows = [
    // nb_turns deliberately hidden from teams so the strategy has to be
    // robust to an unknown horizon.
    ...(isAdmin ? [{ label: t("tournament.view.settings.turns"), value: tournamentData.nb_turns ?? "—" }] : []),
    { label: t("tournament.view.settings.noise"), value: `${(tournamentData.noise_level * 100).toFixed(0)}%` },
    { label: t("tournament.view.settings.phase"), value: tournamentData.phase ?? "—" },
    { label: t("tournament.settings.matching"), value: t("tournament.settings.matching.round_robin") },
    { label: t("tournament.view.settings.created_at"), value: fmt(tournamentData.created_at) }
  ];
  if (tournamentData.launched_at) rows.push({ label: t("tournament.view.settings.launched_at"), value: fmt(tournamentData.launched_at) });
  els.settingsList.innerHTML = rows.map((r) => `
    <li><span class="match-stat-label">${escapeHtml(r.label)}</span><span class="match-stat-value">${escapeHtml(String(r.value))}</span></li>
  `).join("");
}

// ---------- Status-driven UI ----------
function updateStatusUI() {
  const status = tournamentData?.status || "open_submission";
  // open_submission → Launch button.
  // running → Run matches button.
  els.launchBtn.hidden = status !== "open_submission";
  els.runBtn.hidden = status !== "running";
  els.runCancelBtn.hidden = status !== "running";

  if (status === "open_submission") {
    const hasTeams = teamsData.length > 0;
    els.launchBtn.disabled = !hasTeams;
  }
  if (status === "running") {
    const validCount = teamsData.filter((tm) => tm.botValidationStatus === "ok").length;
    els.runBtn.disabled = validCount < 2;
  }

}

// ---------- Available teams (for add modal dropdown) ----------
async function refreshAvailable() {
  const partsSnap = await getDocs(collection(db, "tournaments", tournamentId, "teams"));
  const alreadyIn = new Set();
  partsSnap.forEach((d) => alreadyIn.add(d.id));

  const teamsRef = collection(db, "teams");
  const snap = await getDocs(teamsRef);
  const available = [];
  snap.forEach((d) => {
    if (!alreadyIn.has(d.id)) available.push({ id: d.id, ...d.data() });
  });
  available.sort((a, b) => (a.display_name || "").localeCompare(b.display_name || ""));

  els.pick.innerHTML = "";
  if (available.length === 0) {
    els.pick.disabled = true;
    els.addBtn.disabled = true;
    els.addEmptyHint.hidden = false;
  } else {
    els.pick.disabled = false;
    els.addBtn.disabled = false;
    els.addEmptyHint.hidden = true;
    for (const team of available) {
      const opt = document.createElement("option");
      opt.value = team.id;
      opt.textContent = `${team.emoji ? team.emoji + " " : ""}${team.display_name}`;
      els.pick.appendChild(opt);
    }
  }
}

// ---------- Teams list ----------
async function refreshTeams() {
  const partsSnap = await getDocs(collection(db, "tournaments", tournamentId, "teams"));
  for (const k of Object.keys(latestBotByTeam)) delete latestBotByTeam[k];
  teamsWithoutBot = [];
  teamsData = [];

  if (partsSnap.empty) {
    els.teamsList.innerHTML = "";
    els.teamsEmpty.hidden = false;
    els.teamsCount.textContent = "0";
    renderStats();
    renderHeroDonut(0, 0);
    updateStatusUI();
    return;
  }
  els.teamsEmpty.hidden = true;

  const parts = [];
  partsSnap.forEach((d) => parts.push({ id: d.id, ...d.data() }));
  parts.sort((a, b) => (a.registered_at?.toMillis?.() ?? 0) - (b.registered_at?.toMillis?.() ?? 0));

  const teamDocs = await Promise.all(parts.map((p) => getDoc(doc(db, "teams", p.id))));

  teamsData = parts.map((p, i) => {
    const teamDoc = teamDocs[i];
    const t = teamDoc.exists() ? teamDoc.data() : { display_name: p.id, emoji: "", email: "" };
    if (p.bot_code) {
      latestBotByTeam[p.id] = {
        code: p.bot_code,
        name: p.bot_name,
        submitted_at: p.bot_submitted_at,
        validation_status: p.bot_validation_status,
        validation_message: p.bot_validation_message
      };
    } else {
      teamsWithoutBot.push({ id: p.id, display_name: t.display_name, emoji: t.emoji });
    }
    return {
      id: p.id,
      display_name: t.display_name,
      emoji: t.emoji,
      email: t.email,
      hasBot: !!p.bot_code,
      botName: p.bot_name,
      botValidationStatus: p.bot_validation_status,
      botSubmittedAt: p.bot_submitted_at
    };
  });

  els.teamsCount.textContent = teamsData.length;
  renderTeamsList();
  renderStats();
  const readyCount = teamsData.filter((tm) => tm.botValidationStatus === "ok").length;
  renderHeroDonut(readyCount, teamsData.length);
  updateStatusUI();
}

function renderTeamsList() {
  const q = (els.teamsSearch.value || "").trim().toLowerCase();
  const filtered = q
    ? teamsData.filter((tm) => (tm.display_name || "").toLowerCase().includes(q))
    : teamsData;

  els.teamsList.innerHTML = "";
  for (const tm of filtered) {
    let statusLabel, statusClass, statusSub;
    if (!tm.hasBot) {
      statusLabel = t("teams.card.status.pending");
      statusClass = "warn";
      statusSub = t("tournament.team.row.no_bot");
    } else if (tm.botValidationStatus === "ok") {
      statusLabel = t("tournament.team.row.ready");
      statusClass = "ok";
      statusSub = t("tournament.team.row.all_good");
    } else {
      statusLabel = t("teams.card.status.warning");
      statusClass = "ko";
      statusSub = t("tournament.team.row.invalid_bot");
    }

    const locale = document.documentElement.lang === "fr" ? "fr-FR" : "en-GB";
    const subm = tm.botSubmittedAt?.toDate?.();
    const submStr = subm ? subm.toLocaleString(locale, { dateStyle: "short", timeStyle: "short" }) : "—";
    const submRel = subm ? relativeTime(subm) : "—";

    const validText = tm.hasBot
      ? (tm.botValidationStatus === "ok"
        ? `<span class="t-team-valid ok">100% ${t("tournament.team.row.valid_short")} ✓</span>`
        : `<span class="t-team-valid ko">${t("tournament.team.row.invalid_short")} ✗</span>`)
      : `<span class="muted">—</span>`;

    const li = document.createElement("li");
    li.className = "t-team-row";
    li.innerHTML = `
      <div class="t-team-identity">
        <span class="t-team-emoji">${escapeHtml(tm.emoji || "▣")}</span>
        <div class="t-team-id-body">
          <div class="t-team-name">${escapeHtml(tm.display_name)}</div>
          ${tm.email ? `<div class="t-team-email muted small">${escapeHtml(tm.email)}</div>` : ""}
        </div>
      </div>
      <div class="t-team-col t-team-status">
        <span class="badge ${statusClass}">${escapeHtml(statusLabel)}</span>
        <span class="muted small">${escapeHtml(statusSub)}</span>
      </div>
      <div class="t-team-col t-team-bots">
        <span class="t-team-num">${tm.hasBot ? 1 : 0} / 1</span>
        <span class="muted small">${t("tournament.team.row.submitted")}</span>
      </div>
      <div class="t-team-col t-team-validation">
        ${validText}
      </div>
      <div class="t-team-col t-team-activity">
        <span>${escapeHtml(submRel)}</span>
        <span class="muted small">${escapeHtml(submStr)}</span>
      </div>
      <div class="t-team-actions admin-only">
        ${tm.hasBot ? `<button type="button" class="t-team-iconbtn" data-view="${escapeHtml(tm.id)}" data-name="${escapeHtml(tm.display_name)}" title="${t("tournament.bot.view")}">👁</button>` : ""}
        <button type="button" class="t-team-iconbtn danger" data-del="${escapeHtml(tm.id)}" title="${t("tournament.remove")}">🗑</button>
      </div>
    `;
    els.teamsList.appendChild(li);
  }

  // Wire actions
  els.teamsList.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => openBotModal(btn.dataset.view, btn.dataset.name));
  });
  els.teamsList.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("tournament.remove.confirm"))) return;
      const teamUid = btn.dataset.del;
      try {
        // Read the participation doc first to grab the bot_strategy_id —
        // we need it to also clear the lock fields on the team's strategy.
        // Otherwise the strategy stays "locked" to a tournament the team
        // is no longer registered to.
        const partRef = doc(db, "tournaments", tournamentId, "teams", teamUid);
        const partSnap = await getDoc(partRef);
        const stratId = partSnap.exists() ? partSnap.data().bot_strategy_id : null;

        await deleteDoc(partRef);

        if (stratId) {
          try {
            await updateDoc(doc(db, "teams", teamUid, "strategies", stratId), {
              last_submitted_at: null,
              last_submitted_tournament_id: null
            });
          } catch (e) {
            // Strategy may have been deleted already, or doesn't exist —
            // not fatal, just log it. The participation is gone either way.
            console.warn("Could not clear strategy lock", e);
          }
        }

        await Promise.all([refreshAvailable(), refreshTeams()]);
      } catch (err) {
        console.error(err);
        alert(t("teams.add.error", { msg: err.message || err }));
      }
    });
  });
}

els.teamsSearch.addEventListener("input", renderTeamsList);

// ---------- Stat tiles ----------
function renderStats() {
  const total = teamsData.length;
  const withBot = teamsData.filter((tm) => tm.hasBot).length;
  const valid = teamsData.filter((tm) => tm.botValidationStatus === "ok").length;
  const issues = teamsData.filter((tm) => tm.hasBot && tm.botValidationStatus !== "ok").length;
  const pending = teamsData.filter((tm) => !tm.hasBot).length;
  const pctValid = withBot > 0 ? Math.round((valid / withBot) * 100) : 0;
  const avg = total > 0 ? (withBot / total).toFixed(1) : "0";

  els.statTeams.textContent = total;
  els.statTeamsSub.textContent = t("tournament.stat.teams.sub", { n: withBot });
  els.statBots.textContent = withBot;
  els.statBotsSub.textContent = t("tournament.stat.bots.sub", { n: avg });
  els.statValid.textContent = valid;
  els.statValidSub.textContent = t("tournament.stat.valid.sub", { n: pctValid });
  els.statIssues.textContent = issues;
  els.statPending.textContent = pending;
}

// ---------- Add team modal ----------
els.openAddBtn.addEventListener("click", () => openModal(els.addModal));

els.addForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.addMsg.hidden = true;
  const teamId = els.pick.value;
  if (!teamId) return;
  els.addBtn.disabled = true;
  try {
    await setDoc(doc(db, "tournaments", tournamentId, "teams", teamId), {
      team_id: teamId,
      registered_at: serverTimestamp()
    });
    closeModal(els.addModal);
    await Promise.all([refreshAvailable(), refreshTeams()]);
  } catch (err) {
    console.error(err);
    showMsg(els.addMsg, false, t("teams.add.error", { msg: err.message || err }));
  } finally {
    els.addBtn.disabled = false;
  }
});

// ---------- Bot view modal ----------
function openBotModal(teamId, teamName) {
  const bot = latestBotByTeam[teamId];
  els.botModalTitle.textContent = t("tournament.bot.modal.title", { team: teamName });
  if (!bot) {
    els.botModalCode.textContent = t("tournament.bot.modal.no_code");
    els.botModalStatus.textContent = "";
    els.botModalStatus.className = "badge";
    els.botModalSubmitted.textContent = "";
    els.botModalValidation.hidden = true;
  } else {
    const ts = bot.submitted_at?.toDate?.() ?? null;
    const locale = document.documentElement.lang === "fr" ? "fr-FR" : "en-GB";
    els.botModalSubmitted.textContent = ts
      ? t("tournament.bot.modal.submitted_at", { time: ts.toLocaleString(locale) })
      : "";
    if (bot.validation_status === "ok") {
      els.botModalStatus.textContent = t("tournament.bot.modal.status.valid");
      els.botModalStatus.className = "badge ok";
      els.botModalValidation.hidden = true;
    } else {
      els.botModalStatus.textContent = t("tournament.bot.modal.status.invalid");
      els.botModalStatus.className = "badge ko";
      els.botModalValidation.textContent = bot.validation_message || "";
      els.botModalValidation.hidden = !bot.validation_message;
    }
    els.botModalCode.textContent = bot.code || "";
  }
  openModal(els.botModal);
}

// ---------- Launch tournament ----------
els.launchBtn.addEventListener("click", () => {
  els.launchMsg.hidden = true;
  const missing = teamsWithoutBot;
  if (missing.length === 0) {
    els.launchModalReady.hidden = false;
    els.launchModalMissingIntro.hidden = true;
    els.launchModalMissingList.innerHTML = "";
  } else {
    els.launchModalReady.hidden = true;
    els.launchModalMissingIntro.hidden = false;
    els.launchModalMissingIntro.textContent = t("tournament.launch.modal.missing_intro", { n: missing.length });
    els.launchModalMissingList.innerHTML = missing.map((m) => {
      const label = m.emoji ? `${m.emoji} ${m.display_name}` : m.display_name;
      return `<li>${escapeHtml(label)}</li>`;
    }).join("");
  }
  els.launchConfirmCheck.checked = false;
  els.launchConfirmBtn.disabled = true;
  openModal(els.launchModal);
});

els.launchConfirmCheck.addEventListener("change", () => {
  els.launchConfirmBtn.disabled = !els.launchConfirmCheck.checked;
});

els.launchConfirmBtn.addEventListener("click", async () => {
  els.launchConfirmBtn.disabled = true;
  try {
    await updateDoc(doc(db, "tournaments", tournamentId), {
      status: "running",
      launched_at: serverTimestamp()
    });
    tournamentData.status = "running";
    closeModal(els.launchModal);
    renderHero();
    renderFlow();
    renderSettings();
    updateStatusUI();
    showMsg(els.launchMsg, true, t("tournament.launch.success"));
    // Chain straight into the run — admin shouldn't have to click again.
    await doRunMatches();
  } catch (err) {
    console.error(err);
    closeModal(els.launchModal);
    showMsg(els.launchMsg, false, t("teams.add.error", { msg: err.message || err }));
  } finally {
    els.launchConfirmBtn.disabled = !els.launchConfirmCheck.checked;
  }
});

// ---------- Run matches ----------
// Resume / retry button — confirms first, then runs.
els.runBtn.addEventListener("click", async () => {
  if (!confirm(t("tournament.run.confirm"))) return;
  await doRunMatches();
});

// Soft-cancel: the run loop checks `cancelRequested` between matches and
// throws CancelledError when set. If no run is in progress, clicking Cancel
// still rolls back the status (e.g. the page was reloaded mid-run and the
// tournament is stuck in "running"). The error banner is ephemeral —
// stored only in this admin's session, not persisted.
let cancelRequested = false;
class CancelledError extends Error {
  constructor() { super("cancelled"); this.name = "CancelledError"; }
}

els.runCancelBtn.addEventListener("click", async () => {
  if (!confirm(t("tournament.run.cancel.confirm"))) return;
  cancelRequested = true;
  // If no run is actually executing right now, doRunMatches' catch won't
  // fire, so do the rollback explicitly here. Idempotent either way.
  if (els.runBtn.disabled === false) {
    try {
      await rollbackToOpen(t("tournament.run.cancel.success"));
    } catch (err) {
      console.error(err);
    }
  }
});

// Sets the tournament back to open_submission and shows an error/info banner.
// Used both by the catch in doRunMatches and by the manual cancel handler.
async function rollbackToOpen(bannerMessage) {
  try {
    await updateDoc(doc(db, "tournaments", tournamentId), { status: "open_submission" });
  } catch (e) {
    console.warn("Could not roll back tournament status", e);
  }
  tournamentData.status = "open_submission";
  els.runProgress.hidden = true;
  els.runBtn.disabled = false;
  updateStatusUI();
  if (bannerMessage) showMsg(els.runMsg, false, bannerMessage);
}

// The actual runner. Called either from the resume button or chained right
// after a successful Launch (so the admin doesn't need to click twice).
async function doRunMatches() {
  els.runMsg.hidden = true;
  els.runBtn.disabled = true;
  els.runProgress.hidden = false;
  els.runProgressBar.style.width = "0%";
  cancelRequested = false;
  try {
    setRunStage(t("tournament.run.loading_pyodide"));
    await ensurePyodide();

    // Every registered team participates — those without a valid bot will
    // get synthetic 0-0 matches written to the DB instead of a real Pyodide
    // run. That way the leaderboard, matches list and stats all treat them
    // uniformly downstream.
    const allRegistered = teamsData.map((tm) => ({
      id: tm.id,
      team_name: tm.display_name || tm.id,
      bot_name: latestBotByTeam[tm.id]?.name || "—",
      code: latestBotByTeam[tm.id]?.code || "",
      hasValidBot: tm.botValidationStatus === "ok"
    }));
    const validCount = allRegistered.filter((p) => p.hasValidBot).length;
    if (validCount < 2) throw new Error(t("tournament.run.need_two"));

    const pairs = [];
    for (let i = 0; i < allRegistered.length; i++) {
      for (let j = i + 1; j < allRegistered.length; j++) {
        pairs.push([allRegistered[i], allRegistered[j]]);
      }
    }
    const nbTurns = tournamentData.nb_turns || 30;
    const noise = tournamentData.noise_level || 0;

    const totals = {}, wins = {}, ties = {}, losses = {}, coopSum = {}, matchCount = {};
    for (const p of allRegistered) {
      totals[p.id] = 0; wins[p.id] = 0; ties[p.id] = 0; losses[p.id] = 0;
      coopSum[p.id] = 0; matchCount[p.id] = 0;
    }

    for (let i = 0; i < pairs.length; i++) {
      if (cancelRequested) throw new CancelledError();
      const [a, b] = pairs[i];
      setRunStage(t("tournament.run.match", { i: i + 1, n: pairs.length, a: a.team_name, b: b.team_name }));
      els.runProgressBar.style.width = `${Math.round((i / pairs.length) * 100)}%`;
      await new Promise((r) => setTimeout(r, 0));

      let r;
      if (!a.hasValidBot || !b.hasValidBot) {
        // Synthetic forfeit : both sides get 0 points. Written to the DB
        // like any other match so downstream stats (counts, ties, history)
        // all flow through the same code path.
        let forfeit = null;
        if (!a.hasValidBot && !b.hasValidBot) forfeit = "both";
        else if (!a.hasValidBot) forfeit = "a";
        else forfeit = "b";
        r = { ok: true, score_a: 0, score_b: 0, history_a: "", history_b: "", forfeit };
      } else {
        const seed = hashSeed(`${a.id}__${b.id}__${tournamentId}`);
        r = pythonRunMatch(a.code, b.code, nbTurns, noise, seed);
        if (!r.ok) {
          await writeMatch(a, b, { score_a: 0, score_b: 0, history_a: "", history_b: "", error: r.error }, nbTurns, noise);
          continue;
        }
      }
      totals[a.id] += r.score_a; totals[b.id] += r.score_b;
      matchCount[a.id]++; matchCount[b.id]++;
      if (r.score_a > r.score_b) { wins[a.id]++; losses[b.id]++; }
      else if (r.score_a < r.score_b) { wins[b.id]++; losses[a.id]++; }
      else { ties[a.id]++; ties[b.id]++; }
      coopSum[a.id] += rateOfC(r.history_a);
      coopSum[b.id] += rateOfC(r.history_b);
      await writeMatch(a, b, r, nbTurns, noise);
    }

    const coop = {}, avg_score = {};
    for (const p of allRegistered) {
      coop[p.id] = matchCount[p.id] > 0 ? coopSum[p.id] / matchCount[p.id] : 0;
      avg_score[p.id] = matchCount[p.id] > 0 ? totals[p.id] / matchCount[p.id] : 0;
    }
    setRunStage(t("tournament.run.writing_leaderboard"));
    els.runProgressBar.style.width = "98%";
    await setDoc(doc(db, "tournaments", tournamentId, "leaderboards", "main"), {
      scores: totals, wins, ties, losses, coop, avg_score,
      updated_at: serverTimestamp(), phase: "final"
    });
    await updateDoc(doc(db, "tournaments", tournamentId), {
      status: "completed", completed_at: serverTimestamp()
    });
    tournamentData.status = "completed";
    els.runProgressBar.style.width = "100%";
    setRunStage(t("tournament.run.done", { n: pairs.length }));
    showMsg(els.runMsg, true, t("tournament.run.success", { n: pairs.length }));
    setTimeout(() => {
      window.location.href = `tournament-view.html?t=${encodeURIComponent(tournamentId)}`;
    }, 1200);
  } catch (err) {
    console.error(err);
    // Roll the tournament back to open_submission so the admin can fix
    // whatever broke (e.g. a team's bot that crashed Pyodide) and re-launch.
    // The error stays in the page until refresh — banner is ephemeral.
    const message = err instanceof CancelledError
      ? t("tournament.run.cancel.success")
      : t("tournament.run.error", { msg: err.message || err });
    await rollbackToOpen(message);
  }
}

function setRunStage(text) { els.runProgressLabel.textContent = text; }

async function ensurePyodide() {
  if (pyodide) return;
  const { loadPyodide } = await import("https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.mjs");
  pyodide = await loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/" });
  const sandboxCode = await fetch("./sandbox.py").then((r) => r.text());
  pyodide.runPython(sandboxCode);
}

function pythonRunMatch(codeA, codeB, nbTurns, noise, seed) {
  pyodide.globals.set("_code_a", codeA);
  pyodide.globals.set("_code_b", codeB);
  pyodide.globals.set("_nb", nbTurns);
  pyodide.globals.set("_noise", noise);
  pyodide.globals.set("_seed", seed);
  const proxy = pyodide.runPython("run_tournament_match(_code_a, _code_b, _nb, _noise, _seed)");
  const result = proxy.toJs({ dict_converter: Object.fromEntries });
  proxy.destroy();
  return result;
}

async function writeMatch(a, b, r, nbTurns, noise) {
  const [first, second] = [a.id, b.id].sort();
  const matchId = `${first}__${second}`;
  await setDoc(doc(db, "tournaments", tournamentId, "matches", matchId), {
    team_a_id: a.id, team_b_id: b.id,
    team_a_name: a.team_name, team_b_name: b.team_name,
    bot_a_name: a.bot_name, bot_b_name: b.bot_name,
    score_a: r.score_a ?? 0, score_b: r.score_b ?? 0,
    history_a: r.history_a ?? "", history_b: r.history_b ?? "",
    nb_turns: nbTurns, noise_level: noise,
    forfeit: r.forfeit ?? null, error: r.error ?? null,
    played_at: serverTimestamp()
  });
}

function rateOfC(h) { if (!h) return 0; let c = 0; for (const ch of h) if (ch === "C") c++; return c / h.length; }
function hashSeed(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = s.charCodeAt(i) + ((h << 5) - h); h |= 0; } return Math.abs(h); }

// ---------- Modal helpers ----------
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
    document.querySelectorAll(".modal-backdrop").forEach((m) => { if (!m.hidden) closeModal(m); });
  }
});

document.addEventListener("langchange", () => {
  if (!els.main.hidden) {
    renderHero();
    renderFlow();
    renderSettings();
    refreshAvailable();
    refreshTeams();
  }
});

function showMsg(el, ok, message) {
  el.hidden = false;
  el.classList.remove("ok", "ko");
  el.classList.add(ok ? "ok" : "ko");
  el.textContent = message;
}

function relativeTime(date) {
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return t("time.just_now");
  if (minutes < 60) return t("time.minutes_ago", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("time.hours_ago", { n: hours });
  const days = Math.floor(hours / 24);
  return t("time.days_ago", { n: days });
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
