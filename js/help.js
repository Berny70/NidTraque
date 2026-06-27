// ==========================
// HELP – MULTILINGUE (V7 i18n)
// ==========================

function openHelpPopup() {
  // sécurité anti-doublon
  document.getElementById("helpOverlay")?.remove();
  document.querySelector(".helpOverlaySub")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "helpOverlay";

  overlay.innerHTML = `
    <div class="help-box">
      <h2>${t("help_title")}</h2>

      <button class="help-btn" data-help="install">
        📱 ${t("help_install")}
      </button>

      <button class="help-btn" data-help="vars">
        📊 ${t("help_vars")}
      </button>

      <button class="help-btn" data-help="contact">
        ✉️ ${t("help_contact")}
      </button>

      <br>
      <button onclick="closeHelp()">${t("close")}</button>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.addEventListener("click", e => {
    if (e.target === overlay) closeHelp();
  });

  overlay.querySelectorAll(".help-btn").forEach(btn => {
    btn.onclick = () => openHelpSection(btn.dataset.help);
  });
}

function openHelpSection(type) {
  if (type === "contact") {
    window.open(
      "https://docs.google.com/forms/d/e/1FAIpQLSdZZLGB8u3ULsnCr6GbNkQ9mVIAhWCk2NEatUOeeElGAoMcmg/viewform",
      "_blank",
      "noopener"
    );
    return;
  }

  let html = "";

  if (type === "install") {
    html = `
      <h3>${t("help_install")}</h3>
      <ul>
        <li>${t("install_step_1")}</li>
        <li>${t("install_step_2")}</li>
        <li>${t("install_step_3")}</li>
        <li>${t("install_step_4")}</li>
      </ul>
    `;
  }

  if (type === "vars") {
    html = `
      <h3>${t("help_vars")}</h3>
      <ul>
        <li>${t("vars_1")}</li>
        <li>${t("vars_2")}</li>
        <li>${t("vars_3")}</li>
        <li>${t("vars_4")}</li>
      </ul>
    `;
  }

  openHelpSubPopup(html);
}

function openHelpSubPopup(html) {
  document.querySelector(".helpOverlaySub")?.remove();

  const sub = document.createElement("div");
  sub.className = "helpOverlaySub";
  sub.innerHTML = `
    <div class="help-box">
      ${html}
      <br>
      <button onclick="closeHelp()">${t("close")}</button>
    </div>
  `;

  document.body.appendChild(sub);
}

function closeHelp() {
  document.getElementById("helpOverlay")?.remove();
  document.querySelector(".helpOverlaySub")?.remove();
}

// exposition globale
window.openHelpPopup = openHelpPopup;
