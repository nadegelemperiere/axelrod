import { auth, db } from "./firebase-config.js";
import { logout, isUserAdmin } from "./auth.js";
import { t } from "./i18n.js";
import { playDoorOpen } from "./sound.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import {
  collection,
  query,
  where,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

let cachedIsAdmin = null;

// Global duel notifications. Each team page subscribes once to all duels
// involving this user, and displays a count badge on the "1v1 Duels"
// sidebar link for anything that needs the user's action right now
// (pending invitations to accept, or accepted duels where their strategy
// isn't picked yet). Live updates via onSnapshot — no manual refresh.
const duelDocsForBadge = new Map();
let duelUnsubs = [];
let badgeUid = null;

function isDuelActionable(d) {
  if (d.status === "pending" && d.invitee_uid === badgeUid) return true;
  if (d.status === "accepted") {
    const iAmInviter = d.inviter_uid === badgeUid;
    const myCode = iAmInviter ? d.inviter_strategy_code : d.invitee_strategy_code;
    return !myCode;
  }
  // Finalized duel I haven't seen yet (match result, opponent declined, etc.)
  if (["completed", "declined", "error"].includes(d.status)) {
    const iAmInviter = d.inviter_uid === badgeUid;
    const seen = iAmInviter ? d.inviter_seen : d.invitee_seen;
    return !seen;
  }
  return false;
}

function applyDuelSnap(snap) {
  for (const ch of snap.docChanges()) {
    if (ch.type === "removed") duelDocsForBadge.delete(ch.doc.id);
    else duelDocsForBadge.set(ch.doc.id, ch.doc.data());
  }
  renderDuelsBadge();
}

function renderDuelsBadge() {
  const link = document.querySelector('.sidebar-link[data-page="duels"]');
  if (!link) return;
  const n = [...duelDocsForBadge.values()].filter(isDuelActionable).length;
  let badge = link.querySelector(".sidebar-badge");
  if (n === 0) {
    if (badge) badge.remove();
    return;
  }
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "sidebar-badge";
    link.appendChild(badge);
  }
  badge.textContent = String(n);
}

function subscribeDuelsForBadge(uid) {
  if (badgeUid === uid) return;
  badgeUid = uid;
  duelUnsubs.forEach((fn) => fn());
  duelUnsubs = [];
  duelDocsForBadge.clear();
  const q1 = query(collection(db, "duels"), where("invitee_uid", "==", uid));
  const q2 = query(collection(db, "duels"), where("inviter_uid", "==", uid));
  duelUnsubs.push(onSnapshot(q1, applyDuelSnap));
  duelUnsubs.push(onSnapshot(q2, applyDuelSnap));
}

function refreshRoleLabel() {
  const roleEl = document.getElementById("user-role");
  if (!roleEl || cachedIsAdmin === null) return;
  roleEl.textContent = cachedIsAdmin ? t("sidebar.role.admin") : t("sidebar.role.student");
}

export function initSidebar(activePage) {
  const link = document.querySelector(`.sidebar-link[data-page="${activePage}"]`);
  if (link) link.classList.add("active");

  // Spaceship door whoosh on navigation. Intercept clicks, play sound, then
  // navigate after a short delay so the attack of the sound is heard before
  // the page unloads.
  document.querySelectorAll(".sidebar-link").forEach((a) => {
    if (a.classList.contains("disabled")) return;
    const href = a.getAttribute("href");
    if (!href || href === "#") return;
    a.addEventListener("click", (e) => {
      // Respect open-in-new-tab modifiers
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      playDoorOpen();
      setTimeout(() => { window.location.href = href; }, 300);
    });
  });

  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await logout();
      window.location.href = "index.html";
    });
  }

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    const localPart = user.email.split("@")[0];
    const nameEl = document.getElementById("user-name");
    const avatarEl = document.getElementById("user-avatar");
    if (nameEl) nameEl.textContent = localPart;

    cachedIsAdmin = await isUserAdmin(user.uid);
    refreshRoleLabel();
    if (avatarEl) avatarEl.textContent = (localPart[0] || "?").toUpperCase();

    // Body classes so CSS can target role-based UI globally (admin-only /
    // team-only elements outside the sidebar use these).
    document.body.classList.toggle("is-admin", cachedIsAdmin);
    document.body.classList.toggle("is-team", !cachedIsAdmin);
    document.querySelectorAll(".sidebar-section.admin-only").forEach((el) => {
      el.hidden = !cachedIsAdmin;
    });
    // Symmetric : team-only sections are hidden for admins (so they only
    // see their admin nav when visiting shared pages like tournament-view).
    document.querySelectorAll(".sidebar-section.team-only").forEach((el) => {
      el.hidden = cachedIsAdmin;
    });

    // Live duel notifications for non-admin users only.
    if (!cachedIsAdmin) {
      subscribeDuelsForBadge(user.uid);
    }
  });

  document.addEventListener("langchange", refreshRoleLabel);
}
