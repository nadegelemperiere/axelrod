import { initSidebar } from "./sidebar.js";
import { t } from "./i18n.js";
import { loadTeamContext } from "./team-context.js";
import { db } from "./firebase-config.js";
import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

initSidebar("tournaments-list");

const els = {
  noTeam: document.getElementById("no-team"),
  main: document.getElementById("main"),
  list: document.getElementById("tournament-list")
};

const STATUS_BADGE = {
  open_submission: "warn",
  running: "live",
  completed: "ok"
};

let context = null;

loadTeamContext({
  onLoaded: async (ctx) => {
    context = ctx;
    els.main.hidden = false;
    await refreshList();
  },
  onNoTeam: () => {
    els.noTeam.hidden = false;
  }
});

async function refreshList() {
  // Only tournaments the team is registered to. context.tournaments comes
  // from team-context.js (collection group query on /tournaments/{tid}/teams
  // where team_id == uid), already enriched with each tournament's metadata
  // and sorted by registration date desc.
  const myTournaments = context.tournaments || [];
  els.list.innerHTML = "";
  if (myTournaments.length === 0) {
    const li = document.createElement("li");
    li.className = "tournament-list-card";
    li.style.cursor = "default";
    li.innerHTML = `<div class="tournament-list-card-body muted small" style="text-align: center;">${t("tournaments.list.empty")}</div>`;
    els.list.appendChild(li);
    return;
  }

  // Count teams per tournament — one query per tournament (cheap)
  const teamCounts = await Promise.all(
    myTournaments.map(async (tournament) => {
      const partsSnap = await getDocs(collection(db, "tournaments", tournament.id, "teams"));
      return { id: tournament.id, count: partsSnap.size };
    })
  );
  const teamsByTournament = Object.fromEntries(teamCounts.map((c) => [c.id, c.count]));

  for (const tournament of myTournaments) {
    const teamCount = teamsByTournament[tournament.id] || 0;
    const statusKey = tournament.status || "open_submission";
    const statusLabel = t(`admin.status.${statusKey}`);
    const badgeClass = STATUS_BADGE[statusKey] || "";
    const teamCountLabel = teamCount === 1
      ? t("tournaments.list.teams_count.one", { n: teamCount })
      : t("tournaments.list.teams_count", { n: teamCount });
    const meta = t("tournaments.list.meta", {
      turns: tournament.nb_turns,
      noise: (tournament.noise_level * 100).toFixed(0)
    });
    const hue = hashHue(tournament.id);

    const a = document.createElement("a");
    a.href = `tournament-view.html?t=${encodeURIComponent(tournament.id)}`;
    a.className = "tournament-list-card";
    a.innerHTML = `
      <span class="hex-icon" style="--team-color: hsl(${hue} 75% 60%)">${hexIconSvg(hue)}</span>
      <div class="tournament-list-card-body">
        <h3 class="tournament-list-card-title">
          ${escapeHtml(tournament.name)}
          <span class="badge ${badgeClass}">${escapeHtml(statusLabel)}</span>
        </h3>
        <div class="tournament-list-card-meta">
          <span>${escapeHtml(teamCountLabel)}</span>
          <span>${escapeHtml(meta)}</span>
        </div>
      </div>
      <span class="tournament-list-card-arrow">${t("tournaments.list.view")}</span>
    `;
    els.list.appendChild(a);
  }
}

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
  return `<svg viewBox="0 0 64 64" width="64" height="64" xmlns="http://www.w3.org/2000/svg">
    <polygon points="32,4 56,18 56,46 32,60 8,46 8,18" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="1.5"/>
    <polygon points="32,16 44,23 44,37 32,44 20,37 20,23" fill="${color}" fill-opacity="0.45"/>
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

document.addEventListener("langchange", () => {
  if (!els.main.hidden) refreshList();
});
