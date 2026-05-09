// Tiny i18n helper. Default language = English. Persists in localStorage.
// Static HTML strings use data-i18n / data-i18n-html / data-i18n-placeholder /
// data-i18n-title attributes. Dynamic JS strings use t(key, params).

const STORAGE_KEY = "axelrod-lang";
const DEFAULT_LANG = "en";

const translations = {
  en: {
    "app.tagline": "The Tournament of Minds",
    "app.logout": "Sign out",

    "login.title": "Sign in",
    "login.subtitle": "Python bot tournament · iterated prisoner's dilemma",
    "login.email": "Email",
    "login.password": "Password",
    "login.submit": "Sign in",
    "login.error": "Sign-in failed. Check your email and password.",

    "sidebar.lab": "Laboratory",
    "sidebar.community": "Community",
    "sidebar.admin": "Admin",
    "sidebar.home": "Home",
    "sidebar.playground": "Playground",
    "sidebar.playground.desc": "Experiment and test your strategies",
    "sidebar.strategies": "My strategies",
    "sidebar.strategies.desc": "Create, edit and manage your strategies",
    "sidebar.training": "Training",
    "sidebar.training.desc": "Train and improve your bots",
    "sidebar.leaderboards": "Rankings",
    "sidebar.leaderboards.desc": "Discover the best strategists",
    "sidebar.hallOfFame": "Hall of Fame",
    "sidebar.hallOfFame.desc": "The legends of Axelrod",
    "sidebar.tournaments": "Tournaments",
    "sidebar.tournaments.desc": "Compete against other strategies",
    "sidebar.tournaments.adminDesc": "Manage active tournaments",
    "sidebar.settings": "Settings",
    "sidebar.soon": "Soon",
    "sidebar.role.admin": "Admin",
    "sidebar.role.student": "Student",

    "playground.title": "Playground",
    "playground.subtitle": "Code · test · submit your strategy.",
    "admin.title": "Tournaments",
    "admin.subtitle": "Create and run class tournaments.",

    "welcome.greeting": "Welcome, {name}",
    "welcome.subtitle": "Ready to outwit the sharpest minds?",
    "welcome.season.kicker": "Active tournament",
    "welcome.season.meta": "Phase {phase} · {turns} rounds",
    "hero.banner.title": "AXELROD",
    "hero.banner.tagline": "The tournament where cooperation and betrayal forge legends.",
    "hero.banner.cta": "Launch playground →",

    "loading.pyodide": "Loading Python environment (Pyodide) — about 10 s on first load…",
    "loading.pyodide.error": "Failed to load Python. Reload the page.",

    "noteam.message": "You haven't been assigned to a team yet. Contact your teacher.",
    "access.denied": "Access denied — this account doesn't have admin role.",

    "team.kicker": "> {tournament}",
    "team.meta.html": "Phase <strong>{phase}</strong> · <strong>{turns}</strong> rounds · noise <strong>{noise}%</strong>",
    "team.bot.none": "no bot yet",
    "team.bot.invalid": "submitted (invalid)",
    "team.bot.valid.one": "{n} valid bot",
    "team.bot.valid.many": "{n} valid bots",

    "editor.title": "Your bot's code",
    "editor.reset": "Reset to template",
    "editor.validate": "Validate syntax",
    "editor.reset.confirm": "Reset to the starter template? You'll lose your current code.",

    "arena.title": "Training arena",
    "arena.subtitle": "Test your bot against reference strategies before submitting. Replay as much as you want — nothing is saved.",
    "arena.opponent": "Opponent",
    "arena.turns": "Rounds",
    "arena.noise": "Noise",
    "arena.seed": "Seed",
    "arena.seed.placeholder": "random",
    "arena.run": "▶ Fight",
    "arena.you": "You",
    "arena.vs": "VS",
    "arena.adversary": "opponent",
    "arena.legend.c": "Cooperates",
    "arena.legend.d": "Defects",
    "arena.details.title": "Match details",
    "arena.stat.result": "Result",
    "arena.stat.duration": "Duration",
    "arena.stat.cooperation": "Cooperation",
    "arena.stat.advantage": "Final advantage",
    "arena.stat.longestC": "Longest C streak",
    "arena.stat.longestD": "Longest D streak",
    "arena.stat.duration.value": "{n} rounds",
    "arena.result.win": "Victory",
    "arena.result.loss": "Defeat",
    "arena.result.tie": "Tie",
    "arena.noise.note": "Noise {pct}% applied: shown moves are those received by the opponent (after random flips).",

    "submit.title": "Submit for the tournament",
    "submit.button": "Submit",
    "submit.subtitle": "Saves your current code. You can resubmit as often as you like — only the latest valid version counts for the official tournament.",
    "submit.history": "Your submission history",
    "submit.history.empty": "No submissions yet.",
    "submit.saved": "Submission saved.",
    "submit.invalid": "Submission saved but NOT valid:",
    "submit.error": "Send error: {msg}",
    "submit.badge.valid": "valid",
    "submit.badge.error": "error",
    "submit.pending": "sending…",

    "admin.create.title": "Create a tournament",
    "admin.create.name": "Tournament name",
    "admin.create.name.placeholder": "e.g. Axelrod Junior — June 2026",
    "admin.create.turns": "Rounds per match",
    "admin.create.noise": "Noise level (0 to 0.5)",
    "admin.create.submit": "Create",
    "admin.list.title": "Existing tournaments",
    "admin.list.empty": "No tournament yet.",
    "admin.delete": "Delete",
    "admin.teams": "Teams →",
    "admin.delete.confirm": "Permanently delete this tournament?",
    "admin.status.open_submission": "open",
    "admin.status.running": "running",
    "admin.status.completed": "done",
    "admin.tournament.meta": "phase {phase} · {turns} rounds · noise {noise}%",

    "teams.title.fallback": "Tournament",
    "teams.meta": "phase {phase} · {turns} rounds · noise {noise}% · status {status}",
    "teams.add.title": "Add a team",
    "teams.add.name": "Team name",
    "teams.add.name.placeholder": "The Apricots",
    "teams.add.emoji": "Emoji (1 char)",
    "teams.add.uid": "Firebase UID of the owner account",
    "teams.add.uid.placeholder": "copied from Authentication > Users",
    "teams.add.uid.help": "First create the account (Firebase Console → Authentication → Add user) then paste the UID here.",
    "teams.add.submit": "Add team",
    "teams.add.uid.exists": "This UID is already assigned to team {team} of tournament {tournament}.",
    "teams.add.success": "Team \"{name}\" added.",
    "teams.add.error": "Error: {msg}",
    "teams.list.title": "Registered teams",
    "teams.list.empty": "No team for this tournament yet.",
    "teams.delete.confirm": "Delete this team? Submitted bots will be orphaned (auto-cleanup in Sprint 3).",
    "teams.bot.none": "no bot",
    "teams.bot.count": "{valid}/{total} valid",
    "teams.alert.no.tid": "Missing 't' (tournament id) parameter in URL.",
    "teams.alert.not.found": "Tournament not found.",
    "teams.back": "← Tournaments"
  },

  fr: {
    "app.tagline": "The Tournament of Minds",
    "app.logout": "Déconnexion",

    "login.title": "Connexion",
    "login.subtitle": "Tournoi de bots Python · dilemme du prisonnier itéré",
    "login.email": "Email",
    "login.password": "Mot de passe",
    "login.submit": "Se connecter",
    "login.error": "Connexion échouée. Vérifie email et mot de passe.",

    "sidebar.lab": "Laboratoire",
    "sidebar.community": "Communauté",
    "sidebar.admin": "Admin",
    "sidebar.home": "Accueil",
    "sidebar.playground": "Playground",
    "sidebar.playground.desc": "Expérimente et teste tes stratégies",
    "sidebar.strategies": "Mes stratégies",
    "sidebar.strategies.desc": "Crée, édite et gère tes stratégies",
    "sidebar.training": "Entraînement",
    "sidebar.training.desc": "Entraîne et améliore tes bots",
    "sidebar.leaderboards": "Classements",
    "sidebar.leaderboards.desc": "Découvre les meilleurs stratèges",
    "sidebar.hallOfFame": "Hall of Fame",
    "sidebar.hallOfFame.desc": "Les légendes d'Axelrod",
    "sidebar.tournaments": "Tournois",
    "sidebar.tournaments.desc": "Affronte les autres stratégies",
    "sidebar.tournaments.adminDesc": "Gère les tournois actifs",
    "sidebar.settings": "Paramètres",
    "sidebar.soon": "Bientôt",
    "sidebar.role.admin": "Admin",
    "sidebar.role.student": "Élève",

    "playground.title": "Playground",
    "playground.subtitle": "Code · teste · soumets ta stratégie.",
    "admin.title": "Tournois",
    "admin.subtitle": "Crée et orchestre les tournois de la classe.",

    "welcome.greeting": "Bienvenue, {name}",
    "welcome.subtitle": "Prêt à défier les esprits les plus redoutables ?",
    "welcome.season.kicker": "Tournoi en cours",
    "welcome.season.meta": "Phase {phase} · {turns} tours",
    "hero.banner.title": "AXELROD",
    "hero.banner.tagline": "Le tournoi où la coopération et la trahison façonnent les légendes.",
    "hero.banner.cta": "Lancer le playground →",

    "loading.pyodide": "Chargement de l'environnement Python (Pyodide) — ~10 s la première fois…",
    "loading.pyodide.error": "Erreur au chargement de Python. Recharge la page.",

    "noteam.message": "Tu n'as pas encore été assignée à une équipe. Contacte la prof.",
    "access.denied": "Accès refusé — ce compte n'a pas le rôle admin.",

    "team.kicker": "> {tournament}",
    "team.meta.html": "Phase <strong>{phase}</strong> · <strong>{turns}</strong> tours · bruit <strong>{noise}%</strong>",
    "team.bot.none": "aucun bot",
    "team.bot.invalid": "soumis (invalide)",
    "team.bot.valid.one": "{n} bot valide",
    "team.bot.valid.many": "{n} bots valides",

    "editor.title": "Code de ton bot",
    "editor.reset": "Restaurer le modèle",
    "editor.validate": "Valider la syntaxe",
    "editor.reset.confirm": "Restaurer le modèle de départ ? Tu perds le code actuel.",

    "arena.title": "Arène d'entraînement",
    "arena.subtitle": "Affronte les stratégies de référence avant de soumettre. Relance autant que tu veux — rien n'est sauvegardé.",
    "arena.opponent": "Adversaire",
    "arena.turns": "Tours",
    "arena.noise": "Bruit",
    "arena.seed": "Graine",
    "arena.seed.placeholder": "aléatoire",
    "arena.run": "▶ Affronter",
    "arena.you": "Toi",
    "arena.vs": "VS",
    "arena.adversary": "adversaire",
    "arena.legend.c": "Coopère",
    "arena.legend.d": "Trahit",
    "arena.details.title": "Détails du match",
    "arena.stat.result": "Résultat",
    "arena.stat.duration": "Durée",
    "arena.stat.cooperation": "Coopération",
    "arena.stat.advantage": "Avantage final",
    "arena.stat.longestC": "Plus longue série C",
    "arena.stat.longestD": "Plus longue série D",
    "arena.stat.duration.value": "{n} tours",
    "arena.result.win": "Victoire",
    "arena.result.loss": "Défaite",
    "arena.result.tie": "Égalité",
    "arena.noise.note": "Bruit {pct}% appliqué : les coups affichés sont ceux reçus par l'adversaire (après inversions aléatoires).",

    "submit.title": "Soumettre pour le tournoi",
    "submit.button": "Soumettre",
    "submit.subtitle": "Enregistre la version actuelle de ton code. Tu peux re-soumettre à volonté ; seule la dernière version validée compte pour le tournoi officiel.",
    "submit.history": "Historique de tes soumissions",
    "submit.history.empty": "Aucune soumission pour l'instant.",
    "submit.saved": "Soumission enregistrée.",
    "submit.invalid": "Soumission enregistrée mais NON valide :",
    "submit.error": "Erreur d'envoi: {msg}",
    "submit.badge.valid": "validé",
    "submit.badge.error": "erreur",
    "submit.pending": "envoi en cours…",

    "admin.create.title": "Créer un tournoi",
    "admin.create.name": "Nom du tournoi",
    "admin.create.name.placeholder": "ex : Axelrod Junior — juin 2026",
    "admin.create.turns": "Nombre de tours par match",
    "admin.create.noise": "Niveau de bruit (0 à 0.5)",
    "admin.create.submit": "Créer",
    "admin.list.title": "Tournois existants",
    "admin.list.empty": "Aucun tournoi pour le moment.",
    "admin.delete": "Supprimer",
    "admin.teams": "Équipes →",
    "admin.delete.confirm": "Supprimer ce tournoi définitivement ?",
    "admin.status.open_submission": "ouvert",
    "admin.status.running": "en cours",
    "admin.status.completed": "terminé",
    "admin.tournament.meta": "phase {phase} · {turns} tours · bruit {noise}%",

    "teams.title.fallback": "Tournoi",
    "teams.meta": "phase {phase} · {turns} tours · bruit {noise}% · statut {status}",
    "teams.add.title": "Ajouter une équipe",
    "teams.add.name": "Nom d'équipe",
    "teams.add.name.placeholder": "Les Apricots",
    "teams.add.emoji": "Emoji (1 caractère)",
    "teams.add.uid": "UID Firebase du compte propriétaire",
    "teams.add.uid.placeholder": "copié depuis Authentication > Users",
    "teams.add.uid.help": "Crée d'abord le compte (Console Firebase → Authentication → Add user) puis copie l'UID ici.",
    "teams.add.submit": "Ajouter l'équipe",
    "teams.add.uid.exists": "Cet UID est déjà assigné à l'équipe {team} du tournoi {tournament}.",
    "teams.add.success": "Équipe \"{name}\" ajoutée.",
    "teams.add.error": "Erreur: {msg}",
    "teams.list.title": "Équipes inscrites",
    "teams.list.empty": "Aucune équipe pour ce tournoi.",
    "teams.delete.confirm": "Supprimer cette équipe ? Les bots soumis seront orphelins (cleanup automatique en Sprint 3).",
    "teams.bot.none": "aucun bot",
    "teams.bot.count": "{valid}/{total} valides",
    "teams.alert.no.tid": "Paramètre 't' (tournament id) manquant dans l'URL.",
    "teams.alert.not.found": "Tournoi introuvable.",
    "teams.back": "← Tournois"
  }
};

let currentLang = localStorage.getItem(STORAGE_KEY) || DEFAULT_LANG;
if (!translations[currentLang]) currentLang = DEFAULT_LANG;

export function getLang() {
  return currentLang;
}

export function setLang(lang) {
  if (!translations[lang]) return;
  currentLang = lang;
  localStorage.setItem(STORAGE_KEY, lang);
  document.documentElement.lang = lang;
  applyTranslations();
  document.dispatchEvent(new CustomEvent("langchange", { detail: { lang } }));
}

export function t(key, params = {}) {
  let text = translations[currentLang][key];
  if (text === undefined) text = translations[DEFAULT_LANG][key];
  if (text === undefined) return key;
  for (const [k, v] of Object.entries(params)) {
    text = text.replace(new RegExp(`\\{${k}\\}`, "g"), v);
  }
  return text;
}

export function applyTranslations(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  root.querySelectorAll("[data-i18n-html]").forEach((el) => {
    el.innerHTML = t(el.getAttribute("data-i18n-html"));
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.getAttribute("data-i18n-placeholder"));
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.getAttribute("data-i18n-title"));
  });
}

export function initLangToggle() {
  const buttons = document.querySelectorAll(".lang-toggle");
  if (!buttons.length) return;

  const updateAll = () => {
    buttons.forEach((btn) => {
      btn.textContent = currentLang === "en" ? "FR" : "EN";
      btn.title = currentLang === "en" ? "Passer en français" : "Switch to English";
    });
  };

  updateAll();
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      setLang(currentLang === "en" ? "fr" : "en");
      updateAll();
    });
  });
}

document.documentElement.lang = currentLang;
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    applyTranslations();
    initLangToggle();
  });
} else {
  applyTranslations();
  initLangToggle();
}
