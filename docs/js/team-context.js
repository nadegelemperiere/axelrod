// Shared loader for team pages (home + playground).
// Handles auth gating, admin redirect, no-team state, and Firestore lookups.

import { onAuth, isUserAdmin } from "./auth.js";
import { db } from "./firebase-config.js";
import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

/**
 * Loads the team context for the current user.
 * @param {Object} handlers
 * @param {(ctx: {uid, tournamentId, teamId, tournament, team}) => void} handlers.onLoaded
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

    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (!userDoc.exists()) {
      onNoTeam?.();
      return;
    }
    const { tournament_id, team_id } = userDoc.data();
    const [tSnap, teamSnap] = await Promise.all([
      getDoc(doc(db, "tournaments", tournament_id)),
      getDoc(doc(db, "tournaments", tournament_id, "teams", team_id))
    ]);
    if (!tSnap.exists() || !teamSnap.exists()) {
      onNoTeam?.();
      return;
    }
    onLoaded({
      uid: user.uid,
      tournamentId: tournament_id,
      teamId: team_id,
      tournament: tSnap.data(),
      team: teamSnap.data()
    });
  });
}
