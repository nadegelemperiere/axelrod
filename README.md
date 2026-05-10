# Tournoi Axelrod — Plateforme

Plateforme web pour organiser des tournois de bots Python type **Axelrod** (dilemme du prisonnier itéré) avec des équipes de lycéens.

## Architecture

- **Frontend** : statique, hébergé sur **GitHub Pages** depuis `docs/`
- **Backend** : **Firebase** — Firestore + Auth + Cloud Functions Python
- **Région** : `europe-west1` (Belgique)
- **Identifiant projet Firebase** : `axelrod-6f71e`
- **URL GitHub Pages prévue** : `https://nadegelemperiere.github.io/axelrod/`

## Plan de livraison

| Sprint | Contenu | Statut |
|---|---|---|
| 1 | Squelette : Firebase configuré, Auth email/mdp, panneau admin (créer/lister tournois) | livré |
| 2 | Gestion d'équipes admin + page équipe (Monaco + Pyodide + arène de test + soumission) | livré |
| 3 | Cloud Functions Python sandboxées + page leaderboard | à venir |
| 4 | Live updates : cross-table animée, ticker, leaderboard temps réel | à venir |
| 5 | Replay tour-par-tour, polish, doc admin finale | à venir |

## Setup initial (une seule fois, ~30 min)

### 1. Active les services Firebase

Dans la [console Firebase](https://console.firebase.google.com/project/axelrod-6f71e) :

- **Authentication** → Sign-in method → activer **Email/Password**
- **Firestore Database** → Create database → mode **Production** → région **`europe-west1`**

### 2. Récupère la config web et colle-la dans le code

1. Console Firebase → Settings (roue dentée) → Project settings → onglet **General**
2. Section **Your apps** → s'il n'y a pas d'app web, clique l'icône `</>` pour en créer une (nickname : `axelrod-web`, ne coche pas Hosting)
3. Une fois l'app créée, copie l'objet `firebaseConfig`
4. Ouvre [`docs/js/firebase-config.js`](docs/js/firebase-config.js) et remplace les `REMPLACE_MOI` par les vraies valeurs de `apiKey`, `messagingSenderId` et `appId`

> Ces valeurs ne sont pas secrètes : la sécurité passe par les Firestore rules. Tu peux les committer dans le repo public.

### 3. Déploie les Firestore rules

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only firestore
```

### 4. Crée ton compte admin

1. Console Firebase → **Authentication** → **Add user** → ton email + mot de passe
2. Copie l'**UID** généré (colonne UID dans la liste des users)
3. **Firestore Database** → **Start collection** → ID de collection : `admins` → ID du document : colle ton UID → ajoute un champ `created_at` (type `timestamp`, valeur : maintenant) → Save

### 5. Active GitHub Pages

Sur le repo GitHub : **Settings** → **Pages** → Source : **Deploy from a branch** → Branch : `main` → Folder : `/docs` → Save.

Attends ~1 min, le site est dispo sur `https://nadegelemperiere.github.io/axelrod/`.

### 6. Autorise le domaine GitHub Pages côté Firebase Auth

Console Firebase → **Authentication** → **Settings** → onglet **Authorized domains** → **Add domain** → `nadegelemperiere.github.io`.

Sans cette étape, la connexion échoue depuis GitHub Pages avec une erreur de domaine non autorisé.

### 7. Test

Va sur `https://nadegelemperiere.github.io/axelrod/`, connecte-toi avec ton compte admin, tu dois arriver sur le panneau admin et pouvoir créer un premier tournoi.

## Workflow équipes (Sprint 2)

### Créer une équipe

1. **Console Firebase → Authentication → Add user** : crée un compte pour l'équipe (ex : `team-apricot@axelrod.local` + un mot de passe que tu donneras aux deux ados).
2. Copie l'**UID** généré.
3. Dans le panneau admin, clique sur **Équipes →** à côté du tournoi voulu.
4. Remplis le formulaire **Ajouter une équipe** : nom d'équipe, emoji, UID copié à l'étape 2.

L'équipe peut maintenant se connecter avec l'email/mot de passe du compte et accède directement à `team.html`.

### Côté équipe

- Édite ton bot dans l'éditeur Monaco (Python, coloration syntaxique, sauvegarde locale automatique).
- **Valider la syntaxe** : check rapide AST + appel `play([], [])`.
- **Arène de test** : choisis un adversaire de référence (`tit_for_tat`, `always_defect`, `pavlov`, etc.), nombre de tours, niveau de bruit, et lance un match. Affichage des scores + historique colorisé tour par tour.
- **Soumettre** : enregistre la version actuelle dans Firestore. Tu peux re-soumettre autant de fois que tu veux ; seule la dernière version validée est utilisée pour le tournoi officiel.

L'arène de test tourne entièrement dans le navigateur via **Pyodide** (~10 s à charger la première fois). Aucune exécution serveur en Sprint 2 — le tournoi officiel sandboxé arrive en Sprint 3.

## Workflow quotidien

- **Modifier le frontend** : édite les fichiers dans `docs/`, push sur `main`, GitHub Pages redéploie en ~1 min.
- **Modifier les règles Firestore** : édite `firestore.rules`, lance `firebase deploy --only firestore`.
- **Voir les logs** : Console Firebase → Firestore → onglet **Usage**.

## Modèle de données Firestore

```
/admins/{uid}                          # UIDs admin (un doc par admin)

/teams/{uid}                           # Équipes top-level — uid = UID Firebase Auth
  fields:                                du compte partagé par les 2 élèves
    display_name, emoji,
    active_tournament_id (nullable),
    created_at

  /strategies/{strategyId}             # Bibliothèque persistante de l'équipe,
    fields:                              survit aux changements de tournoi
      name, description, code,
      validation_status, validation_message,
      created_at, updated_at, last_submitted_at,
      benchmark_results, benchmark_score, benchmark_coop, benchmark_profile

/tournaments/{tournamentId}            # Tournois (métadonnées seulement)
  fields:
    name, nb_turns, noise_level, phase, status,
    created_at, updated_at

  /bots/{botId}                        # Soumissions au tournoi
    fields:
      team_id (= uid),                   # quelle équipe a soumis
      strategy_id (nullable),            # lien vers la stratégie source
      name, code, submitted_at,
      validation_status, validation_message

  /matches/{matchId}                   # Matches (Sprint 3, écrits par CF)
    fields:
      phase, bot_a_team, bot_b_team, score_a, score_b,
      history_a, history_b, played_at

  /leaderboards/{phaseId}              # Classements par phase (Sprint 3)
    fields:
      scores: { teamId: totalScore, ... }, updated_at
```

Schéma simplifié depuis le Sprint Strategies : les **équipes existent indépendamment des tournois** (top-level `/teams/{uid}`), avec `active_tournament_id` qui pointe vers le tournoi courant (ou null). Plus de collection `/users/{uid}` — la team se trouve directement à `/teams/{user.uid}`. Les **stratégies** sont une sous-collection de l'équipe et persistent à travers tous les tournois.

## Structure du repo

```
axelrod/
├── docs/                     # Frontend, racine GitHub Pages
│   ├── index.html            # Page de connexion
│   ├── admin.html            # Panneau admin (tournois)
│   ├── teams.html            # Panneau admin (équipes d'un tournoi)
│   ├── team.html             # Page équipe (éditeur + arène + soumission)
│   ├── sandbox.py            # Sandbox Pyodide (bots de référence + run_match)
│   ├── css/style.css
│   └── js/
│       ├── firebase-config.js
│       ├── auth.js
│       ├── login.js
│       ├── admin.js
│       ├── teams.js
│       └── team.js
├── functions/                # Cloud Functions Python (Sprint 3)
├── firestore.rules           # Règles de sécurité
├── firestore.indexes.json
├── firebase.json             # Config déploiement
├── .firebaserc               # Lien projet Firebase
└── README.md
```

## Sécurité — résumé

- **Lecture** : tout utilisateur signé peut lire tournois, équipes, leaderboards, matches.
- **Écriture admin** : création/modif/suppression de tournois et équipes seulement si l'UID est dans `/admins/{uid}`.
- **Mapping `/users/{uid}`** : chaque utilisateur ne lit que sa propre entrée (admin lit tout). Écriture admin uniquement.
- **Soumission de bots** : seule l'équipe propriétaire (`uid_owner == request.auth.uid` sur la team doc) peut créer un nouveau bot dans sa sous-collection. Pas d'update ni delete (chaque soumission est une nouvelle version).
- **Matches et leaderboards** : écriture exclusivement par les Cloud Functions (Sprint 3).
- **Aucune donnée personnelle d'élève** dans Firestore : les comptes sont créés par la prof avec des emails neutres (`team-apricot@…`), et le mapping équipe ↔ élèves reste hors-ligne.

## Coûts

Plan **Blaze** (pay-as-you-go) requis pour les Cloud Functions, mais l'usage attendu rentre largement dans le free tier :

- Firestore : ~200 écritures + ~2000 lectures par tournoi (free : 50k lectures/jour)
- Functions : ~10 invocations par session (free : 2M/mois)
- Coût attendu : **0 €**. Mettre une **alerte budget à 5 €/mois** dans Google Cloud Console par sécurité.

## Sources d'inspiration

- Axelrod, R. (1980). *Effective Choice in the Prisoner's Dilemma.* Journal of Conflict Resolution.
- Nowak & Sigmund (1993). *A strategy of win-stay, lose-shift that outperforms tit-for-tat.* Nature.
