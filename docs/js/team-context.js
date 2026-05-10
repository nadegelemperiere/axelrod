// Shared loader for team pages (home + playground + strategies).
// Handles auth gating, admin redirect, and team/tournament lookup.
//
// Schema:
//   /teams/{uid}                       — team doc (uid = auth uid)
//     active_tournament_id             — current tournament (or null)
//   /tournaments/{tid}                 — tournament metadata

import { onAuth, isUserAdmin } from "./auth.js";
import { db } from "./firebase-config.js";
import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

/**
 * Loads the team context for the current user.
 * @param {Object} handlers
 * @param {(ctx: {uid, teamId, tournamentId, tournament, team}) => void} handlers.onLoaded
 *   tournamentId may be null if the team has no active tournament.
 *   tournament may be null if the team has no active tournament.
 * @param {() => void} [handlers.onNoTeam]
 */
export function loadTeamContext({ onLoaded, onNoTeam }) {
  onAuth(async (user) => {
    if (!user) {
      window.location.href = "index.html";
      return;
    }
    const admin = await isUserAdmin(user.uid);
    if (admin) {
      window.location.href = "admin.html";
      return;
    }

    const teamSnap = await getDoc(doc(db, "teams", user.uid));
    if (!teamSnap.exists()) {
      onNoTeam?.();
      return;
    }
    const teamData = teamSnap.data();
    const tournamentId = teamData.active_tournament_id || null;

    let tournament = null;
    if (tournamentId) {
      const tSnap = await getDoc(doc(db, "tournaments", tournamentId));
      if (tSnap.exists()) tournament = tSnap.data();
    }

    onLoaded({
      uid: user.uid,
      teamId: user.uid,        // alias: uid IS teamId now
      tournamentId,
      tournament,
      team: teamData
    });
  });
}
