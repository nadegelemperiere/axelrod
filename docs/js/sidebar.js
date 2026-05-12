import { auth } from "./firebase-config.js";
import { logout, isUserAdmin } from "./auth.js";
import { t } from "./i18n.js";
import { playDoorOpen } from "./sound.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

let cachedIsAdmin = null;

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

    document.querySelectorAll(".sidebar-section.admin-only").forEach((el) => {
      el.hidden = !cachedIsAdmin;
    });
  });

  document.addEventListener("langchange", refreshRoleLabel);
}
