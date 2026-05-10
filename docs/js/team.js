import { initSidebar } from "./sidebar.js";
import { t } from "./i18n.js";
import { loadTeamContext } from "./team-context.js";

initSidebar("home");

const els = {
  noTeam: document.getElementById("no-team"),
  main: document.getElementById("main"),
  welcomeGreeting: document.getElementById("welcome-greeting"),
  welcomeSeasonName: document.getElementById("welcome-season-name"),
  welcomeSeasonMeta: document.getElementById("welcome-season-meta")
};

let context = null;

loadTeamContext({
  onLoaded: (ctx) => {
    context = ctx;
    renderHome();
    els.main.hidden = false;
  },
  onNoTeam: () => {
    els.noTeam.hidden = false;
  }
});

function renderHome() {
  const team = context.team;
  const tournament = context.tournament;
  els.welcomeGreeting.textContent = t("welcome.greeting", { name: team.display_name });
  if (tournament) {
    els.welcomeSeasonName.textContent = tournament.name;
    els.welcomeSeasonMeta.textContent = t("welcome.season.meta", {
      phase: tournament.phase,
      turns: tournament.nb_turns
    });
  } else {
    els.welcomeSeasonName.textContent = "—";
    els.welcomeSeasonMeta.textContent = t("noteam.message");
  }
}

document.addEventListener("langchange", () => {
  if (context) renderHome();
});
