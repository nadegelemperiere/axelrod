import { login, onAuth, isUserAdmin } from "./auth.js";
import { t } from "./i18n.js";

const form = document.getElementById("login-form");
const errEl = document.getElementById("error");
const submitBtn = form.querySelector("button[type=submit]");

onAuth(async (user) => {
  if (!user) return;
  const admin = await isUserAdmin(user.uid);
  if (admin) {
    window.location.href = "admin.html";
  } else {
    window.location.href = "team.html";
  }
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errEl.hidden = true;
  submitBtn.disabled = true;
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  try {
    await login(email, password);
  } catch (err) {
    errEl.textContent = t("login.error");
    errEl.hidden = false;
    console.error(err);
  } finally {
    submitBtn.disabled = false;
  }
});
