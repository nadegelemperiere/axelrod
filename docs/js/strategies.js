import { initSidebar } from "./sidebar.js";
import { t, getLang } from "./i18n.js";
import { loadTeamContext } from "./team-context.js";
import { db } from "./firebase-config.js";
import {
  doc,
  getDoc,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

initSidebar("strategies");

const els = {
  noTeam: document.getElementById("no-team"),
  main: document.getElementById("main"),
  libSearch: document.getElementById("lib-search"),
  libList: document.getElementById("lib-list"),
  detailEmpty: document.getElementById("detail-empty"),
  detailContent: document.getElementById("detail-content"),
  detailName: document.getElementById("detail-name"),
  detailStatus: document.getElementById("detail-status"),
  detailCode: document.getElementById("detail-code"),
  detailDescription: document.getElementById("detail-description"),
  detailCreated: document.getElementById("detail-created"),
  detailModified: document.getElementById("detail-modified"),
  detailSubmitted: document.getElementById("detail-submitted"),
  detailMsg: document.getElementById("detail-msg"),
  btnTest: document.getElementById("btn-test"),
  btnDuplicate: document.getElementById("btn-duplicate"),
  btnDelete: document.getElementById("btn-delete"),
  btnSubmit: document.getElementById("btn-submit"),
  btnRunBenchmarks: document.getElementById("btn-run-benchmarks"),
  profileEmpty: document.getElementById("profile-empty"),
  profileContent: document.getElementById("profile-content"),
  profileRadar: document.getElementById("profile-radar"),
  testsList: document.getElementById("tests-list"),
  testsEmpty: document.getElementById("tests-empty"),
  submitModal: document.getElementById("submit-modal"),
  submitName: document.getElementById("submit-name"),
  submitConfirmCheck: document.getElementById("submit-confirm-check"),
  submitConfirmBtn: document.getElementById("submit-confirm-btn"),
  renameModal: document.getElementById("rename-modal"),
  renameName: document.getElementById("rename-name"),
  renameConfirmBtn: document.getElementById("rename-confirm-btn"),
  loadingBanner: document.getElementById("loading-banner")
};

let context = null;
let strategies = [];
let selectedId = null;
let pyodide = null;
let radarChart = null;
let activeStrategyTab = "code";

const REF_BOTS = ["always_cooperate", "always_defect", "tit_for_tat", "grudger", "random"];

// ---------- Boot ----------
loadTeamContext({
  onLoaded: async (ctx) => {
    context = ctx;
    els.main.hidden = false;
    await refreshStrategies();
    // Auto-select first strategy if any
    if (strategies.length) selectStrategy(strategies[0].id);
  },
  onNoTeam: () => {
    els.noTeam.hidden = false;
  }
});

// ---------- Firestore ----------
function strategiesCollection() {
  return collection(db, "teams", context.uid, "strategies");
}

async function refreshStrategies() {
  const q = query(strategiesCollection(), orderBy("updated_at", "desc"));
  const snap = await getDocs(q);
  strategies = [];
  snap.forEach((d) => strategies.push({ id: d.id, ...d.data() }));
  renderLibrary();
}

// ---------- Library list ----------
function renderLibrary() {
  const search = (els.libSearch.value || "").trim().toLowerCase();
  const filtered = search
    ? strategies.filter((s) => (s.name || "").toLowerCase().includes(search))
    : strategies;

  els.libList.innerHTML = "";
  if (filtered.length === 0) {
    const li = document.createElement("li");
    li.className = "lib-item";
    li.style.cursor = "default";
    li.innerHTML = `<span class="muted small" style="grid-column: 1 / -1; text-align: center; padding: 1rem 0;">${t("strategies.library.empty")}</span>`;
    els.libList.appendChild(li);
    return;
  }

  for (const s of filtered) {
    const li = document.createElement("li");
    li.className = "lib-item" + (s.id === selectedId ? " selected" : "");
    li.dataset.id = s.id;

    const status = s.validation_status === "ok" ? "ready" : s.validation_status === "error" ? "error" : "draft";
    const statusBadge = `<span class="badge ${status === "ready" ? "ok" : status === "error" ? "ko" : ""}">${t(`strategies.status.${status}`)}</span>`;

    li.innerHTML = `
      <img class="lib-item-avatar" src="${avatarUrl(s.name || s.id)}" alt="" />
      <div class="lib-item-body">
        <div class="lib-item-name">${escapeHtml(s.name || "Untitled")}</div>
        <div class="lib-item-meta">
          ${s.benchmark_score != null
            ? `<span><strong>${s.benchmark_score}</strong> ${t("strategies.library.score").toLowerCase()}</span>`
            : ""}
          ${s.benchmark_coop != null
            ? `<span><strong>${(s.benchmark_coop * 100).toFixed(0)}%</strong> ${t("strategies.library.cooperation").toLowerCase()}</span>`
            : ""}
        </div>
        <div class="lib-item-time">${t("strategies.library.modified", { time: relativeTime(s.updated_at) })}</div>
      </div>
      ${statusBadge}
    `;
    li.addEventListener("click", () => selectStrategy(s.id));
    els.libList.appendChild(li);
  }
}

els.libSearch.addEventListener("input", () => renderLibrary());

// ---------- Selection / detail ----------
function selectStrategy(id) {
  selectedId = id;
  const s = strategies.find((x) => x.id === id);
  if (!s) {
    els.detailEmpty.hidden = false;
    els.detailContent.hidden = true;
    return;
  }
  renderLibrary(); // re-render to update selected state
  els.detailEmpty.hidden = true;
  els.detailContent.hidden = false;

  els.detailName.value = s.name || "";
  els.detailDescription.value = s.description || "";
  els.detailCode.textContent = s.code || "";

  const status = s.validation_status === "ok" ? "ready" : s.validation_status === "error" ? "error" : "draft";
  els.detailStatus.textContent = t(`strategies.status.${status}`);
  els.detailStatus.className = `badge strategy-status ${status === "ready" ? "ok" : status === "error" ? "ko" : ""}`;

  els.detailCreated.textContent = relativeTime(s.created_at);
  els.detailModified.textContent = relativeTime(s.updated_at);
  els.detailSubmitted.textContent = s.last_submitted_at
    ? relativeTime(s.last_submitted_at)
    : t("strategies.detail.never_submitted");

  els.detailMsg.hidden = true;

  renderProfileFromStrategy(s);
  renderTestsFromStrategy(s);
}

// ---------- Tabs (Code / Info) ----------
document.querySelectorAll(".strategy-tabs .tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    activeStrategyTab = btn.dataset.tab;
    document.querySelectorAll(".strategy-tabs .tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".strategy-tab-content").forEach((c) => {
      c.hidden = c.id !== `strategy-tab-${activeStrategyTab}`;
    });
  });
});

// ---------- Inline name edit ----------
els.detailName.addEventListener("change", async () => {
  if (!selectedId) return;
  const newName = els.detailName.value.trim();
  if (!newName) {
    const s = strategies.find((x) => x.id === selectedId);
    els.detailName.value = s?.name || "";
    return;
  }
  await updateDoc(doc(strategiesCollection(), selectedId), {
    name: newName,
    updated_at: serverTimestamp()
  });
  await refreshStrategies();
  selectStrategy(selectedId);
});

// ---------- Description edit (autosave on blur) ----------
els.detailDescription.addEventListener("blur", async () => {
  if (!selectedId) return;
  const desc = els.detailDescription.value;
  const s = strategies.find((x) => x.id === selectedId);
  if (s && (s.description || "") === desc) return;
  await updateDoc(doc(strategiesCollection(), selectedId), {
    description: desc,
    updated_at: serverTimestamp()
  });
  await refreshStrategies();
});

// ---------- Edit & test → playground ----------
els.btnTest.addEventListener("click", () => {
  if (!selectedId) return;
  window.location.href = `playground.html?strategy=${encodeURIComponent(selectedId)}`;
});

// ---------- Duplicate ----------
els.btnDuplicate.addEventListener("click", async () => {
  if (!selectedId) return;
  const s = strategies.find((x) => x.id === selectedId);
  if (!s) return;
  const newRef = await addDoc(strategiesCollection(), {
    name: (s.name || "Untitled") + t("strategies.duplicate.suffix"),
    description: s.description || "",
    code: s.code || "",
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
    validation_status: s.validation_status || "draft",
    validation_message: s.validation_message || "",
    last_submitted_at: null
  });
  await refreshStrategies();
  selectStrategy(newRef.id);
});

// ---------- Delete ----------
els.btnDelete.addEventListener("click", async () => {
  if (!selectedId) return;
  if (!confirm(t("strategies.delete.confirm"))) return;
  await deleteDoc(doc(strategiesCollection(), selectedId));
  selectedId = null;
  await refreshStrategies();
  if (strategies.length) selectStrategy(strategies[0].id);
  else {
    els.detailEmpty.hidden = false;
    els.detailContent.hidden = true;
  }
});

// ---------- Submit modal ----------
els.btnSubmit.addEventListener("click", () => {
  if (!selectedId) return;
  const s = strategies.find((x) => x.id === selectedId);
  if (!s) return;
  els.submitName.value = s.name || "";
  els.submitConfirmCheck.checked = false;
  els.submitConfirmBtn.disabled = true;
  openModal(els.submitModal);
});

els.submitConfirmCheck.addEventListener("change", () => {
  els.submitConfirmBtn.disabled = !els.submitConfirmCheck.checked;
});

els.submitConfirmBtn.addEventListener("click", async () => {
  if (!selectedId) return;
  const s = strategies.find((x) => x.id === selectedId);
  if (!s) return;
  els.submitConfirmBtn.disabled = true;
  try {
    // Validate via Pyodide (light check before submitting to /bots).
    await ensurePyodide();
    const validation = pyodide ? pythonValidate(s.code) : { ok: true, message: "" };

    if (!context.tournamentId) {
      throw new Error(t("strategies.detail.empty"));
    }
    await addDoc(
      collection(db, "tournaments", context.tournamentId, "bots"),
      {
        team_id: context.uid,
        code: s.code,
        submitted_at: serverTimestamp(),
        validation_status: validation.ok ? "ok" : "error",
        validation_message: validation.message,
        strategy_id: s.id,
        name: els.submitName.value.trim() || s.name || "Untitled"
      }
    );

    await updateDoc(doc(strategiesCollection(), selectedId), {
      last_submitted_at: serverTimestamp()
    });

    closeModal(els.submitModal);
    showMsg(els.detailMsg, true, t("playground.submit.success", { name: els.submitName.value.trim() }));
    await refreshStrategies();
    selectStrategy(selectedId);
  } catch (err) {
    console.error(err);
    showMsg(els.detailMsg, false, t("submit.error", { msg: err.message || err }));
  } finally {
    els.submitConfirmBtn.disabled = !els.submitConfirmCheck.checked;
  }
});

// ---------- Run benchmarks ----------
els.btnRunBenchmarks.addEventListener("click", async () => {
  if (!selectedId) return;
  const s = strategies.find((x) => x.id === selectedId);
  if (!s) return;

  els.btnRunBenchmarks.disabled = true;
  els.btnRunBenchmarks.textContent = t("strategies.profile.running");
  els.loadingBanner.hidden = false;

  try {
    await ensurePyodide();
    const t_ = context.tournament || { nb_turns: 30, noise_level: 0 };
    const results = {};
    for (const opp of REF_BOTS) {
      const r = pythonRunTest(s.code, opp, t_.nb_turns, 0, null);
      if (r.ok) {
        results[opp] = {
          score_a: r.score_a,
          score_b: r.score_b,
          history_a: r.history_a,
          history_b: r.history_b
        };
      }
    }

    // Compute averages
    const totalScore = Object.values(results).reduce((acc, r) => acc + r.score_a, 0);
    const avgScore = Math.round(totalScore / Math.max(1, Object.keys(results).length));
    const totalCoop = Object.values(results).reduce((acc, r) => {
      const coop = (r.history_a.match(/C/g) || []).length;
      return acc + coop / r.history_a.length;
    }, 0);
    const avgCoop = totalCoop / Math.max(1, Object.keys(results).length);

    // Profile metrics: aggregate analyze over each match
    const profile = computeProfileFromResults(results);

    await updateDoc(doc(strategiesCollection(), selectedId), {
      benchmark_results: results,
      benchmark_score: avgScore,
      benchmark_coop: avgCoop,
      benchmark_profile: profile,
      benchmark_at: serverTimestamp(),
      updated_at: serverTimestamp()
    });

    await refreshStrategies();
    selectStrategy(selectedId);
  } catch (err) {
    console.error(err);
    showMsg(els.detailMsg, false, t("submit.error", { msg: err.message || err }));
  } finally {
    els.btnRunBenchmarks.disabled = false;
    els.btnRunBenchmarks.textContent = t("strategies.profile.run");
    els.loadingBanner.hidden = true;
  }
});

function computeProfileFromResults(results) {
  let coopSum = 0, defectSum = 0, forgiveSum = 0, exploitSum = 0;
  let stabSum = 0;
  let count = 0;
  for (const r of Object.values(results)) {
    const ha = r.history_a;
    const hb = r.history_b;
    const nb = ha.length;
    const coop = (ha.match(/C/g) || []).length / nb;
    coopSum += coop;
    defectSum += 1 - coop;
    // Forgiveness: how often I cooperate after opp defected
    let forgiveCh = 0, forgive = 0;
    for (let i = 1; i < nb; i++) {
      if (hb[i - 1] === "D") {
        forgiveCh++;
        if (ha[i] === "C") forgive++;
      }
    }
    forgiveSum += forgiveCh > 0 ? forgive / forgiveCh : 0;
    // Exploitability: how often I cooperate after opp defected without retaliation later
    exploitSum += forgiveCh > 0 ? (forgive / forgiveCh) * (1 - coop) + 0 : 0;
    // Stability: 1 - (transitions / nb)
    let trans = 0;
    for (let i = 1; i < nb; i++) if (ha[i] !== ha[i - 1]) trans++;
    stabSum += 1 - trans / Math.max(1, nb - 1);
    count++;
  }
  if (count === 0) return null;
  return {
    cooperation: coopSum / count,
    aggression: defectSum / count,
    forgiveness: forgiveSum / count,
    stability: stabSum / count,
    exploitability: Math.min(1, exploitSum / count + 0.2 * (1 - stabSum / count))
  };
}

// ---------- Profile radar ----------
function renderProfileFromStrategy(s) {
  if (!s.benchmark_profile) {
    els.profileEmpty.hidden = false;
    els.profileContent.hidden = true;
    return;
  }
  els.profileEmpty.hidden = true;
  els.profileContent.hidden = false;
  renderRadar(s.benchmark_profile);
}

async function renderRadar(p) {
  if (!window.Chart) {
    try {
      const mod = await import("https://cdn.jsdelivr.net/npm/chart.js@4.4.4/auto/+esm");
      window.Chart = mod.default || mod.Chart;
    } catch {
      try {
        await new Promise((resolve, reject) => {
          const sc = document.createElement("script");
          sc.src = "vendor/chart.umd.js";
          sc.onload = resolve;
          sc.onerror = reject;
          document.head.appendChild(sc);
        });
      } catch (err) {
        console.error("Chart.js failed to load", err);
        return;
      }
    }
  }
  const labels = [
    t("strategies.profile.cooperation"),
    t("strategies.profile.aggression"),
    t("strategies.profile.forgiveness"),
    t("strategies.profile.stability"),
    t("strategies.profile.exploitability")
  ];
  const data = [p.cooperation, p.aggression, p.forgiveness, p.stability, p.exploitability].map((x) => Math.round(x * 100));
  if (radarChart) {
    radarChart.data.labels = labels;
    radarChart.data.datasets[0].data = data;
    radarChart.update();
    return;
  }
  radarChart = new window.Chart(els.profileRadar, {
    type: "radar",
    data: {
      labels,
      datasets: [{
        label: "",
        data,
        backgroundColor: "rgba(95, 227, 216, 0.18)",
        borderColor: "#5fe3d8",
        borderWidth: 2,
        pointBackgroundColor: "#5fe3d8",
        pointRadius: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        r: {
          suggestedMin: 0,
          suggestedMax: 100,
          ticks: { display: false, stepSize: 25 },
          grid: { color: "rgba(95, 227, 216, 0.15)" },
          angleLines: { color: "rgba(95, 227, 216, 0.2)" },
          pointLabels: {
            color: "#c5d4d9",
            font: { family: "JetBrains Mono", size: 10, weight: "600" }
          }
        }
      }
    }
  });
}

// ---------- Quick tests ----------
function renderTestsFromStrategy(s) {
  els.testsList.innerHTML = "";
  const r = s.benchmark_results || {};
  const keys = Object.keys(r);
  if (keys.length === 0) {
    els.testsEmpty.hidden = false;
    return;
  }
  els.testsEmpty.hidden = true;
  for (const opp of REF_BOTS) {
    if (!r[opp]) continue;
    const m = r[opp];
    const li = document.createElement("li");
    li.className = "tests-row";
    li.innerHTML = `
      <img class="opp-mini" src="${avatarUrl(opp)}" alt="" />
      <span class="opp-name">${formatOppName(opp)}</span>
      <span class="opp-result"><span class="you-val">${m.score_a}</span> · <span class="opp-val">${m.score_b}</span></span>
    `;
    els.testsList.appendChild(li);
  }
}

// ---------- Pyodide (lazy) ----------
async function ensurePyodide() {
  if (pyodide) return;
  try {
    const { loadPyodide } = await import("https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.mjs");
    pyodide = await loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/" });
    const sandboxCode = await fetch("./sandbox.py").then((r) => r.text());
    pyodide.runPython(sandboxCode);
  } catch (err) {
    console.error("Pyodide init failed", err);
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

// ---------- Modals ----------
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

// ---------- Helpers ----------
function showMsg(el, ok, msg) {
  el.hidden = false;
  el.classList.remove("ok", "ko");
  el.classList.add(ok ? "ok" : "ko");
  el.textContent = msg;
}

function avatarUrl(seed) {
  return `https://api.dicebear.com/7.x/bottts-neutral/svg?seed=${encodeURIComponent(seed || "default")}&backgroundColor=transparent`;
}

function formatOppName(opp) {
  return opp.split("_").map((w) => (w[0] || "").toUpperCase() + w.slice(1)).join(" ");
}

function relativeTime(ts) {
  if (!ts) return "—";
  const date = ts.toDate ? ts.toDate() : new Date(ts);
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

document.addEventListener("langchange", () => {
  renderLibrary();
  if (selectedId) selectStrategy(selectedId);
});
