// Shared loader for team pages (home + playground + strategies + tournament-view).
// Handles auth gating, admin redirect, team identity, and the list of
// tournaments the team is currently registered to.
//
// Schema:
//   /teams/{uid}                                            — team identity
//     /strategies/{id}                                      — persistent library
//   /tournaments/{tid}/teams/{teamId}                       — participation doc
//     { team_id, registered_at, bot_*? }
//
// The team's tournaments are discovered via a collection group query on `teams`
// filtered by `team_id == uid`. Sorted by registered_at desc, the "primary"
// tournament is the most recent registration — used as the default context
// for pages that need a singular tournament (welcome banner, playground params).

import { onAuth, isUserAdmin } from "./auth.js";
import { db } from "./firebase-config.js";
import {
  doc,
  getDoc,
  collectionGroup,
  query,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

/**
 * Loads the team context for the current user.
 * @param {Object} handlers
 * @param {(ctx: {
 *   uid, teamId, team,
 *   tournaments: Array<{ id, name, nb_turns, noise_level, phase, status, participation }>,
 *   tournamentId: string | null,        // primary (most recent)
 *   tournament: object | null            // primary tournament data
 * }) => void} handlers.onLoaded
 * @param {() => void} [handlers.onNoTeam]
 */
export function loadTeamContext({ onLoaded, onNoTeam, allowAdmin = false }) {
  onAuth(async (user) => {
    if (!user) {
      window.location.href = "index.html";
      return;
    }
    const admin = await isUserAdmin(user.uid);
    if (admin) {
      if (!allowAdmin) {
        window.location.href = "admin.html";
        return;
      }
      // Admin viewer: minimal context, no team identity.
      onLoaded({
        uid: user.uid,
        teamId: null,
        team: null,
        isAdmin: true,
        tournaments: [],
        tournamentId: null,
        tournament: null
      });
      return;
    }

    const teamSnap = await getDoc(doc(db, "teams", user.uid));
    if (!teamSnap.exists()) {
      onNoTeam?.();
      return;
    }

    // Collection group query: all participation docs for this team across tournaments.
    const partsQ = query(
      collectionGroup(db, "teams"),
      where("team_id", "==", user.uid)
    );
    const partsSnap = await getDocs(partsQ);

    // Load each tournament's metadata in parallel.
    const tournaments = await Promise.all(
      partsSnap.docs.map(async (partDoc) => {
        const tournamentRef = partDoc.ref.parent.parent;
        if (!tournamentRef) return null;
        const tSnap = await getDoc(tournamentRef);
        if (!tSnap.exists()) return null;
        return {
          id: tournamentRef.id,
          participation: { id: partDoc.id, ...partDoc.data() },
          ...tSnap.data()
        };
      })
    );
    const validTournaments = tournaments.filter(Boolean);
    // Most recently registered first
    validTournaments.sort((a, b) => {
      const at = a.participation.registered_at?.toMillis?.() ?? 0;
      const bt = b.participation.registered_at?.toMillis?.() ?? 0;
      return bt - at;
    });

    const primary = validTournaments[0] || null;

    onLoaded({
      uid: user.uid,
      teamId: user.uid,
      team: teamSnap.data(),
      tournaments: validTournaments,
      tournamentId: primary ? primary.id : null,
      tournament: primary
    });
  });
}
