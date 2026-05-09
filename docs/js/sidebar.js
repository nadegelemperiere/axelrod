import { auth } from "./firebase-config.js";
import { logout, isUserAdmin } from "./auth.js";
import { t } from "./i18n.js";
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
