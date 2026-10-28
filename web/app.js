import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { firebaseConfig, API_BASE_URL } from "/firebase-config.js";

const $ = (selector) => document.querySelector(selector);

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const loginView = $("#loginView");
const homeView = $("#homeView");
const adminLoginView = $("#adminLoginView");
const appView = $("#appView");
const dialog = $("#actionDialog");
const isAdminRoute = location.pathname === "/admin" || location.pathname === "/admin/";

let currentUser = null;
let profile = null;
let txs = [];
let registering = false;
let authScreenOpened = false;
let activeAction = "cashin";
let hideBalance = false;
let rouletteAudioContext = null;
let adminLoginInProgress = false;

function openAuth(mode = "login") {
  authScreenOpened = true;
  registering = mode === "register";
  homeView.classList.add("hidden");
  appView.classList.add("hidden");
  loginView.classList.remove("hidden");
  $("#registrationFields").classList.toggle("hidden", !registering);
  $("#fullName").required = registering;
  $("#mobile").required = registering;
  $("#submitLabel").textContent = registering ? "Create account" : "Sign in";
  $("#registerToggle").textContent = registering
    ? "Already registered? Sign in"
    : "Create an account";
  showError("");
}

document.querySelectorAll("[data-open-auth]").forEach((button) => {
  button.addEventListener("click", () => openAuth(button.dataset.openAuth));
});

document.querySelectorAll("[data-back-home]").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    authScreenOpened = false;
    registering = false;
    loginView.classList.add("hidden");
    homeView.classList.remove("hidden");
  });
});

function money(value) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
  }).format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
}

async function api(path, method = "GET", body) {
  if (!currentUser) {
    throw new Error("Please sign in first.");
  }

  const token = await currentUser.getIdToken();

  const response = await fetch(API_BASE_URL + path, {
    method,
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }

  return data;
}

function showError(message, target = "#loginMessage") {
  const element = $(target);

  if (element) {
    element.textContent = message;
  }
}

function showToast(message) {
  const toast = $("#toast");

  toast.textContent = message;
  toast.classList.add("show");

  setTimeout(() => toast.classList.remove("show"), 2500);
}

function showPage(page) {
  const pageIds = {
    dashboard: "dashboardPage", activity: "activityPage", games: "gamesPage",
    settings: "settingsPage", admin: "adminPage", "admin-users": "adminUsersPage",
    "admin-transactions": "adminTransactionsPage", "admin-games": "adminGamesPage",
  };
  Object.entries(pageIds).forEach(([name, id]) => {
    $(`#${id}`)?.classList.toggle("hidden", name !== page);
  });

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("active", button.dataset.page === page);
  });
}

function closeProfileMenu() {
  $("#profileMenu").classList.add("hidden");
  $("#profileButton").setAttribute("aria-expanded", "false");
}

$("#profileButton").onclick = () => {
  const menu = $("#profileMenu");
  const opening = menu.classList.contains("hidden");
  menu.classList.toggle("hidden", !opening);
  $("#profileButton").setAttribute("aria-expanded", String(opening));
};

document.addEventListener("click", (event) => {
  if (!event.target.closest(".profile-menu-wrap")) closeProfileMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeProfileMenu();
});

document.querySelectorAll("[data-profile-page]").forEach((button) => {
  button.onclick = () => {
    showPage(button.dataset.profilePage);
    closeProfileMenu();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
});

$("#copyAccountId").onclick = async () => {
  try {
    await navigator.clipboard.writeText(profile?.uid || "");
    showToast("Account ID copied.");
  } catch {
    showToast(`Account ID: ${(profile?.uid || "").slice(-8).toUpperCase()}`);
  }
};

$("#profileLogoutButton").onclick = () => signOut(auth);

function empty() {
  return '<div class="transaction-empty">No activity yet.</div>';
}

function row(transaction) {
  const isRouletteWin = transaction.type === "ROULETTE_WIN";
  const incoming = [
    "CASH_IN",
    "TRANSFER_RECEIVED",
    ...(isRouletteWin ? [transaction.type] : []),
  ].includes(transaction.type);
  let amount = Number(transaction.amount) || 0;

  // Older roulette win records stored the stake, so derive the net from details.
  if (isRouletteWin) {
    const net = transaction.details?.match(/net (-?[\d.]+)/);
    const payout = transaction.details?.match(/payout ([\d.]+)/);
    if (net) amount = Number(net[1]);
    else if (payout) amount = Number(payout[1]) - Number(transaction.amount);
  }

  const sign = incoming ? "+" : "−";

  return `
    <article class="transaction-row">
      <span class="transaction-symbol ${incoming ? "" : "outgoing"}">
        ${incoming ? "↓" : "↗"}
      </span>

      <span class="transaction-info">
        <strong>${escapeHtml((transaction.type || "").replaceAll("_", " "))}</strong>
        <small>
          ${escapeHtml(transaction.details)} ·
          ${escapeHtml(transaction.createdAt || "")}
        </small>
      </span>

      <span class="transaction-amount ${incoming ? "incoming" : "outgoing"}">
        ${sign}${money(amount)}
      </span>
    </article>`;
}

async function refresh() {
  profile = await api("/api/me");
  txs = await api("/api/transactions");

  const name = profile.fullName || currentUser.email || "User";
  const firstName = name.split(" ")[0];

  $("#profileName").textContent = name;
  $("#firstName").textContent = firstName;
  $("#avatar").textContent = firstName.charAt(0).toUpperCase();
  $("#profileMenuName").textContent = name;
  $("#profileMenuEmail").textContent = currentUser.email || "No email available";
  $("#profileMenuMobile").textContent = profile.mobile || "No mobile number saved";
  $("#settingsName").value = profile.fullName || "";
  $("#settingsMobile").value = profile.mobile || "";
  $("#settingsEmail").value = currentUser.email || "";

  $("#accountNumber").textContent = (profile.uid || "").slice(-8).toUpperCase();

  $("#balanceValue").textContent = hideBalance
    ? "₱ ••••••"
    : money(profile.balance);

  $("#recentTransactions").innerHTML =
    txs.slice(0, 4).map(row).join("") || empty();

  const query = $("#transactionSearch").value.toLowerCase();

  const filtered = txs.filter((transaction) =>
    `${transaction.type || ""} ${transaction.details || ""}`
      .toLowerCase()
      .includes(query),
  );

  $("#allTransactions").innerHTML = filtered.map(row).join("") || empty();

  $("#activityCount").textContent = `${txs.length} transactions`;

  if (location.pathname === "/admin") {
    await loadAdmin();
  }

  const games = await api("/api/games");

  $("#gameHistory").innerHTML =
    games
      .map(
        (game) => `
          <article class="transaction-row">
            <span class="transaction-info">
              <strong>
                ${game.win ? "Win" : "Loss"} ·
                ${escapeHtml(game.choice)}
              </strong>

              <small>
                Result ${game.result} (${rouletteColor(game.result)}) ·
                Bet ${money(game.bet)} ·
                ${escapeHtml(game.createdAt)}
              </small>
            </span>

            <span>${game.win ? "+" : ""}${money(game.net)}</span>
          </article>
        `,
      )
      .join("") || empty();
}

function adminUserCards(users, withActions = true) {
  if (!users.length) return empty();
  const cards = users.map((user) => `
      <article class="admin-record">
        <div class="admin-record-main">
          <strong>${escapeHtml(user.fullName || "Unnamed account")}</strong>
          <span>${escapeHtml(user.email || "Email not recorded")}</span>
          <small>
            ${escapeHtml(user.mobile || "No mobile")} ·
            ID ${escapeHtml(user.uid)} ·
            Registered ${escapeHtml(user.createdAt || "Unknown")}
          </small>
        </div>
        <div class="admin-record-side">
          <strong>${money(user.balance)}</strong>
          <small>${escapeHtml(user.status || "active")}</small>
          ${withActions ? `
            <div class="admin-actions">
              <button data-user-detail="${escapeHtml(user.uid)}">Details</button>
              <button data-user-edit="${escapeHtml(user.uid)}">Edit</button>
              <button data-user-adjust="${escapeHtml(user.uid)}">Balance</button>
              <button
                data-user-block="${escapeHtml(user.uid)}"
                data-status="${escapeHtml(user.status || "active")}">
                ${user.status === "blocked" ? "Unblock" : "Block"}
              </button>
            </div>` : ""}
        </div>
      </article>
    `).join("");

  return `<div class="admin-record-list">${cards}</div>`;
}

function adminAuditList(entries) {
  if (!entries.length) return empty();

  return entries.map((entry) => `
    <article class="transaction-row">
      <span class="transaction-info">
        <strong>${escapeHtml(entry.action || "Admin action")}</strong>
        <small>
          ${escapeHtml(entry.createdAt || "")} ·
          Account ${escapeHtml(entry.targetUid || "")} ·
          ${escapeHtml(entry.details || "")}
        </small>
      </span>
    </article>
  `).join("");
}

function adminTransactionCards(transactions) {
  if (!transactions.length) return empty();

  return `<div class="admin-record-list">${transactions.map((entry) => `
    <article class="admin-record">
      <div class="admin-record-main">
        <strong>
          ${escapeHtml((entry.type || "Transaction").replaceAll("_", " "))} ·
          ${escapeHtml(entry.fullName || "Unknown user")}
        </strong>
        <span>
          ${escapeHtml(entry.email || entry.mobile || "")} ·
          ID ${escapeHtml(entry.uid || "")}
        </span>
        <small>
          ${escapeHtml(entry.details || "")} ·
          ${escapeHtml(entry.createdAt || "")}
        </small>
      </div>
      <div class="admin-record-side"><strong>${money(entry.amount)}</strong></div>
    </article>
  `).join("")}</div>`;
}

function adminGameCards(games) {
  if (!games.length) return empty();

  return `<div class="admin-record-list">${games.map((game) => `
    <article class="admin-record">
      <div class="admin-record-main">
        <strong>
          ${escapeHtml(game.fullName || "Unknown user")} ·
          ${game.win ? "Win" : "Loss"}
        </strong>
        <span>
          ${escapeHtml(game.email || game.mobile || "")} ·
          ID ${escapeHtml(game.uid || "")}
        </span>
        <small>
          Roulette: bet ${escapeHtml(game.choice)} ·
          Result ${game.result} (${rouletteColor(game.result)}) ·
          Played ${escapeHtml(game.createdAt || "")}
        </small>
      </div>
      <div class="admin-record-side">
        <strong>${money(game.bet)}</strong>
        <small>${game.win ? `Won ${money(game.payout)}` : `Lost ${money(game.bet)}`}</small>
      </div>
    </article>
  `).join("")}</div>`;
}

async function loadAdmin() {
  const contentIds = [
    "#adminOverviewContent",
    "#adminUsersContent",
    "#adminTransactionsContent",
    "#adminGamesContent",
  ];

  try {
    const [summary, users, transactions, games, audit] = await Promise.all([
      api("/api/admin/summary"),
      api("/api/admin/users"),
      api("/api/admin/transactions"),
      api("/api/admin/games"),
      api("/api/admin/audit"),
    ]);

    $("#adminOverviewContent").innerHTML = `
      <div class="admin-stat-grid">
        <article class="admin-stat">
          <span>Registered accounts</span><strong>${summary.users}</strong>
        </article>
        <article class="admin-stat">
          <span>Active accounts</span><strong>${summary.activeAccounts}</strong>
        </article>
        <article class="admin-stat">
          <span>Total virtual wallet funds</span>
          <strong>${money(summary.totalBalance)}</strong>
        </article>
        <article class="admin-stat">
          <span>Virtual cash-ins</span>
          <strong>${money(summary.cashInAmount)}</strong>
          <small>${summary.cashIns} cash-in records</small>
        </article>
        <article class="admin-stat">
          <span>Transfer volume</span>
          <strong>${money(summary.transferAmount)}</strong>
          <small>${summary.transfers} transfer records</small>
        </article>
        <article class="admin-stat">
          <span>Transactions</span><strong>${summary.transactions}</strong>
        </article>
        <article class="admin-stat">
          <span>Roulette games played</span><strong>${summary.games}</strong>
        </article>
        <article class="admin-stat">
          <span>Virtual bets</span><strong>${money(summary.totalBets)}</strong>
          <small>${summary.wins} wins · ${summary.losses} losses</small>
        </article>
      </div>
      <section class="admin-section">
        <div class="section-heading">
          <div><p class="eyebrow">ACCOUNT DIRECTORY</p><h2>Registered accounts</h2></div>
          <button class="text-button" data-admin-goto="admin-users">Manage users →</button>
        </div>
        ${adminUserCards(users, false)}
      </section>
      <section class="admin-section">
        <div class="section-heading">
          <div><p class="eyebrow">ADMINISTRATOR ACTIVITY</p><h2>Recent admin actions</h2></div>
        </div>
        ${adminAuditList(audit)}
      </section>`;

    $("#adminUsersContent").innerHTML = `
      <section class="full-activity-card">
        <div class="activity-toolbar">
          <div>
            <h2>All accounts</h2>
            <p class="subheading">${users.length} registered accounts</p>
          </div>
          <label class="search-box">
            <span>⌕</span>
            <input id="adminUserSearch" type="search" placeholder="Search name, email, mobile, or ID">
          </label>
        </div>
        <div id="adminUserList">${adminUserCards(users)}</div>
        <div id="adminDetail"></div>
      </section>
      <section class="admin-section">
        <h2>Admin action history</h2>
        ${adminAuditList(audit)}
      </section>`;

    $("#adminTransactionsContent").innerHTML = adminTransactionCards(transactions);
    $("#adminGamesContent").innerHTML = adminGameCards(games);

    const search = $("#adminUserSearch");
    if (search) {
      search.oninput = () => {
        const query = search.value.toLowerCase();
        document.querySelectorAll("#adminUserList .admin-record").forEach((card) => {
          card.hidden = !card.textContent.toLowerCase().includes(query);
        });
      };
    }

    document.querySelectorAll("[data-admin-goto]").forEach((button) => {
      button.onclick = () => showPage(button.dataset.adminGoto);
    });

    document.querySelectorAll("[data-user-block]").forEach((button) => {
      button.onclick = async () => {
        try {
          await api(
            `/api/admin/users/${button.dataset.userBlock}/block`,
            "POST",
            { blocked: button.dataset.status !== "blocked" },
          );
          await loadAdmin();
        } catch (error) {
          showToast(error.message);
        }
      };
    });

    document.querySelectorAll("[data-user-detail]").forEach((button) => {
      button.onclick = async () => {
        try {
          const detail = await api(
            `/api/admin/users/${button.dataset.userDetail}/details`,
          );
          const gameHistory = detail.games.map((game) => `
            <article class="transaction-row">
              <span class="transaction-info">
                <strong>${game.win ? "Win" : "Loss"} · bet ${escapeHtml(game.choice)}</strong>
                <small>
                  Result ${game.result} (${rouletteColor(game.result)}) ·
                  ${escapeHtml(game.createdAt || "")}
                </small>
              </span>
              <span>${money(game.net)}</span>
            </article>
          `).join("");

          $("#adminDetail").innerHTML = `
            <section class="admin-section">
              <h2>${escapeHtml(detail.fullName)}’s account</h2>
              <p>
                ${escapeHtml(detail.email || "")} ·
                ${escapeHtml(detail.mobile || "")} ·
                ${money(detail.balance)} ·
                Registered ${escapeHtml(detail.createdAt || "")}
              </p>
              <h3>Transactions</h3>
              ${detail.transactions.map(row).join("") || empty()}
              <h3>Roulette game history</h3>
              ${gameHistory || empty()}
            </section>`;
        } catch (error) {
          showToast(error.message);
        }
      };
    });

    document.querySelectorAll("[data-user-edit]").forEach((button) => {
      button.onclick = async () => {
        const user = users.find((item) => item.uid === button.dataset.userEdit);
        if (!user) return;

        const fullName = prompt("Full name", user.fullName || "");
        if (fullName === null) return;

        const mobile = prompt("Mobile number", user.mobile || "");
        if (mobile === null || !fullName.trim() || !mobile.trim()) return;

        try {
          await api(`/api/admin/users/${user.uid}`, "PUT", {
            fullName: fullName.trim(),
            mobile: mobile.trim(),
          });
          await loadAdmin();
        } catch (error) {
          showToast(error.message);
        }
      };
    });

    document.querySelectorAll("[data-user-adjust]").forEach((button) => {
      button.onclick = async () => {
        const amount = Number(
          prompt("Balance change in PHP (negative to subtract)"),
        );
        if (!Number.isFinite(amount) || amount === 0) return;

        const reason = prompt("Reason for adjustment");
        if (!reason?.trim()) return;

        try {
          await api(
            `/api/admin/users/${button.dataset.userAdjust}/adjust`,
            "POST",
            { amount, reason: reason.trim() },
          );
          await loadAdmin();
        } catch (error) {
          showToast(error.message);
        }
      };
    });
  } catch (error) {
    contentIds.forEach((selector) => {
      const content = $(selector);
      if (content) content.textContent = error.message;
    });
  }
}

$("#profileSettingsForm").onsubmit = async (event) => {
  event.preventDefault();
  const button = $("#profileSettingsForm button[type='submit']");
  button.disabled = true;
  $("#settingsMessage").textContent = "Saving your profile…";
  try {
    await api("/api/profile", "PUT", {
      fullName: $("#settingsName").value.trim(),
      mobile: $("#settingsMobile").value.trim(),
    });
    await refresh();
    $("#settingsMessage").textContent = "Profile updated.";
    showToast("Profile updated.");
  } catch (error) {
    $("#settingsMessage").textContent = error.message;
  } finally {
    button.disabled = false;
  }
};

$("#registerToggle").onclick = () => {
  openAuth(registering ? "login" : "register");
};

$("#loginForm").onsubmit = async (event) => {
  event.preventDefault();
  const submitButton = $("#loginForm button[type='submit']");
  submitButton.disabled = true;

  try {
    const email = $("#email").value.trim();
    const password = $("#password").value;

    if (registering) {
      const credential = await createUserWithEmailAndPassword(
        auth,
        email,
        password,
      );

      currentUser = credential.user;

      await api("/api/register", "POST", {
        fullName: $("#fullName").value.trim(),
        mobile: $("#mobile").value.trim(),
      });
      await signOut(auth);
      currentUser = null;
      registering = false;
      $("#password").value = "";
      openAuth("login");
      showError("Account created. Please sign in with your email and password.");
    } else {
      await signInWithEmailAndPassword(auth, email, password);
      showError("");
    }
  } catch (error) {
    showError(error.message);
  } finally {
    submitButton.disabled = false;
  }
};

function showAdminLogin(message = "") {
  homeView.classList.add("hidden");
  loginView.classList.add("hidden");
  appView.classList.add("hidden");
  adminLoginView.classList.remove("hidden");
  document.querySelectorAll(".admin-nav-item").forEach((item) => item.classList.add("hidden"));
  document.querySelectorAll(".user-nav-item").forEach((item) => item.classList.remove("hidden"));
  if (message.includes("Administrator access required")) {
    message = "Sign-in worked, but this account has no admin permission yet. Run the SetAdmin setup command with this account’s Firebase UID, then sign out and sign in again.";
  } else if (message.includes("Account profile is missing")) {
    message = "This account has no BankIt profile yet. Run SetAdmin with its UID to create the profile and admin permission.";
  } else if (message.includes("timed out")) {
    message = "The BankIt server did not respond within 15 seconds. Check that the server is running in the other PowerShell window, then try again.";
  } else if (message === "Failed to fetch") {
    message = "Cannot reach the BankIt server at localhost:8080. Start it in the other PowerShell window, then try again.";
  }
  $("#adminLoginMessage").textContent = message;
}

async function enterAdminDashboard() {
  const account = await api("/api/me");
  if (account.status !== "active") throw new Error("This account is blocked.");

  // This protected request confirms the Firebase admin custom claim.
  await api("/api/admin/summary");

  adminLoginView.classList.add("hidden");
  homeView.classList.add("hidden");
  loginView.classList.add("hidden");
  appView.classList.remove("hidden");
  document.querySelectorAll(".admin-nav-item").forEach((item) => item.classList.remove("hidden"));
  document.querySelectorAll(".user-nav-item").forEach((item) => item.classList.add("hidden"));
  $(".topbar .eyebrow").textContent = "BANKIT ADMIN";
  showPage("admin");
  await refresh();
}

$("#adminLoginForm").onsubmit = async (event) => {
  event.preventDefault();
  const button = $("#adminLoginForm button[type='submit']");
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Checking access…";
  $("#adminLoginMessage").textContent = "Signing in and checking administrator permission…";
  adminLoginInProgress = true;

  try {
    const credential = await signInWithEmailAndPassword(
      auth,
      $("#adminEmail").value.trim(),
      $("#adminPassword").value,
    );
    currentUser = credential.user;

    // Refresh claims so a recently granted admin role is visible immediately.
    const token = await currentUser.getIdTokenResult(true);
    if (!token.claims.admin) {
      throw new Error("Sign-in succeeded, but this Firebase account does not have the admin permission. Run the SetAdmin command below with this account's UID, then try again.");
    }

    await enterAdminDashboard();
  } catch (error) {
    const messages = {
      "auth/invalid-credential": "Email or password is incorrect. Use the email and password of the Firebase Authentication user for this UID.",
      "auth/user-not-found": "No Firebase Authentication user exists for this email. Create the user in Firebase Console first.",
      "auth/wrong-password": "The password is incorrect. Reset it in Firebase Console, then try again.",
    };
    showAdminLogin(messages[error.code] || error.message);
  } finally {
    adminLoginInProgress = false;
    button.disabled = false;
    button.textContent = originalLabel;
  }
};

onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  // Registration creates the Firebase Auth user before its Firestore profile.
  // Let the registration submit handler finish that profile before checking /api/me.
  if (registering) {
    return;
  }

  if (isAdminRoute) {
    if (adminLoginInProgress) return;
    if (!user) {
      showAdminLogin();
      return;
    }

    try {
      await enterAdminDashboard();
    } catch (error) {
      showAdminLogin(error.message);
    }
    return;
  }

  adminLoginView.classList.add("hidden");

  if (!user) {
    appView.classList.add("hidden");
    if (!authScreenOpened) {
      loginView.classList.add("hidden");
      homeView.classList.remove("hidden");
    }
    return;
  }

  try {
    const token = await user.getIdTokenResult();
    if (token.claims.admin) {
      window.location.replace("/admin");
      return;
    }

    const account = await api("/api/me");

    if (account.status !== "active") {
      throw new Error("This account is blocked.");
    }

    loginView.classList.add("hidden");
    homeView.classList.add("hidden");
    appView.classList.remove("hidden");

    await refresh();
  } catch (error) {
    appView.classList.add("hidden");
    homeView.classList.add("hidden");
    loginView.classList.remove("hidden");

    showError(error.message);
  }
});

$("#logoutButton").onclick = () => signOut(auth);

$("#toggleBalance").onclick = () => {
  hideBalance = !hideBalance;

  $("#balanceValue").textContent = hideBalance
    ? "₱ ••••••"
    : money(profile?.balance);
};

document.querySelectorAll("[data-page]").forEach((button) => {
  button.onclick = () => showPage(button.dataset.page);
});

document.querySelectorAll("[data-action]").forEach((button) => {
  button.onclick = () => {
    activeAction = button.dataset.action;

    const transfer = activeAction === "transfer";

    $("#dialogTitle").textContent = transfer ? "Send money" : "Cash in";
    $("#dialogDescription").textContent = transfer
      ? "Send virtual money to another BankIt demo account using the recipient’s mobile number."
      : "Add virtual funds to your demo wallet to explore the app’s transaction features.";
    $("#receiverField").classList.toggle("hidden", !transfer);

    $("#confirmAction").textContent = transfer
      ? "Send transfer"
      : "Add virtual funds";

    $("#actionMessage").textContent = "";

    dialog.showModal();
  };
});

$("#transactionSearch").oninput = () => {
  const query = $("#transactionSearch").value.toLowerCase();

  const filtered = txs.filter((transaction) =>
    `${transaction.type || ""} ${transaction.details || ""}`
      .toLowerCase()
      .includes(query),
  );

  $("#allTransactions").innerHTML = filtered.map(row).join("") || empty();
};

$("#closeDialog").onclick = () => dialog.close();

$("#actionForm").onsubmit = async (event) => {
  event.preventDefault();

  try {
    const amount = Number($("#amount").value);

    if (activeAction === "cashin") {
      await api("/api/cashin", "POST", { amount });
    } else {
      await api("/api/transfer", "POST", {
        amount,
        mobile: $("#receiver").value.trim(),
      });
    }

    dialog.close();

    await refresh();

    showToast("Transaction saved.");
  } catch (error) {
    showError(error.message, "#actionMessage");
  }
};

const redNumbers = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

function rouletteColor(number) {
  if (Number(number) === 0) return "Green";
  return redNumbers.has(Number(number)) ? "Red" : "Black";
}

for (let number = 0; number <= 36; number++) {
  const option = document.createElement("option");
  option.value = String(number);
  const color = rouletteColor(number);
  option.textContent = `${number} — ${color.toUpperCase()}`;
  option.dataset.color = color.toLowerCase();
  option.style.color = {
    Green: "#168056",
    Red: "#bd3940",
    Black: "#171a18",
  }[color];
  $("#rouletteNumbers").appendChild(option);
}

function rouletteTile(number) {
  const color = rouletteColor(number).toLowerCase();
  return `<span class="reel-tile ${color}"><small>${color}</small><strong>${number}</strong></span>`;
}

function prepareRouletteSound() {
  if (!$("#rouletteSound").checked) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    $("#rouletteSound").checked = false;
    showToast("Sound effects are not supported in this browser.");
    return;
  }
  rouletteAudioContext ||= new AudioContextClass();
  rouletteAudioContext.resume().catch(() => {});
}

function playRouletteTone(frequency, startAt, duration = 0.045, volume = 0.035) {
  const context = rouletteAudioContext;
  if (!context || context.state !== "running" || !$("#rouletteSound").checked) return;

  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(volume, startAt);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration);
}

function playRouletteResultSound(won) {
  if (!$("#rouletteSound").checked || !rouletteAudioContext) return;
  const now = rouletteAudioContext.currentTime + 0.02;

  if (won) {
    // A few short filtered noise bursts make a soft applause sound.
    [0, 0.16, 0.34].forEach((delay, index) => {
      const duration = 0.12;
      const sampleCount = Math.floor(rouletteAudioContext.sampleRate * duration);
      const buffer = rouletteAudioContext.createBuffer(1, sampleCount, rouletteAudioContext.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < sampleCount; i++) samples[i] = Math.random() * 2 - 1;

      const source = rouletteAudioContext.createBufferSource();
      const filter = rouletteAudioContext.createBiquadFilter();
      const gain = rouletteAudioContext.createGain();
      source.buffer = buffer;
      filter.type = "highpass";
      filter.frequency.setValueAtTime(900 + index * 180, now + delay);
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.13, now + delay + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + duration);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(rouletteAudioContext.destination);
      source.start(now + delay);
      source.stop(now + delay + duration);
    });
    return;
  }

  // A gentle descending tone gives a losing result a sad, low-key sound.
  [392, 330, 262].forEach((note, index) => {
    const startAt = now + index * 0.2;
    const oscillator = rouletteAudioContext.createOscillator();
    const gain = rouletteAudioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(note, startAt);
    oscillator.frequency.exponentialRampToValueAtTime(note * 0.78, startAt + 0.28);
    gain.gain.setValueAtTime(0.045, startAt);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.3);
    oscillator.connect(gain);
    gain.connect(rouletteAudioContext.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + 0.31);
  });
}

function resetRouletteReel() {
  $("#rouletteReel").style.transition = "none";
  $("#rouletteReel").style.transform = "translateX(0)";
  $("#rouletteReel").innerHTML = Array.from(
    { length: 85 },
    () => rouletteTile(Math.floor(Math.random() * 37)),
  ).join("");
}

function spinRouletteReel(result, won) {
  const reel = $("#rouletteReel");
  const window = $("#rouletteReelWindow");
  const winningIndex = 68;
  const duration = 7500;
  const tiles = Array.from({ length: 85 }, () => rouletteTile(Math.floor(Math.random() * 37)));
  tiles[winningIndex] = rouletteTile(Number(result));
  reel.style.transition = "none";
  reel.style.transform = "translateX(0)";
  reel.innerHTML = tiles.join("");
  void reel.offsetWidth;

  const winningTile = reel.children[winningIndex];
  const offset = winningTile.offsetLeft + winningTile.offsetWidth / 2 - window.clientWidth / 2;
  reel.style.transition = `transform ${duration}ms cubic-bezier(.06,.7,.12,1)`;
  reel.style.transform = `translateX(-${offset}px)`;
  return new Promise((resolve) => {
    const startedAt = performance.now();
    let tickTimer;

    const playTick = () => {
      const elapsed = performance.now() - startedAt;
      const progress = Math.min(elapsed / duration, 1);
      if (progress >= 0.97 || !$("#rouletteSound").checked) return;
      playRouletteTone(1150, rouletteAudioContext?.currentTime || 0, 0.025, 0.022);
      const nextDelay = 65 + 280 * progress * progress;
      tickTimer = setTimeout(playTick, nextDelay);
    };

    reel.addEventListener("transitionend", () => {
      clearTimeout(tickTimer);
      playRouletteResultSound(won);
      resolve();
    }, { once: true });

    if ($("#rouletteSound").checked) playTick();
  });
}

resetRouletteReel();

$("#spinButton").onclick = async () => {
  const button = $("#spinButton");

  button.disabled = true;
  prepareRouletteSound();

  try {
    const result = await api("/api/roulette", "POST", {
      amount: Number($("#rouletteBet").value),
      choice: $("#rouletteChoice").value,
      requestId: crypto.randomUUID(),
    });

    await spinRouletteReel(result.game.result, result.game.win);

    $("#rouletteResult").textContent =
      `Result: ${result.game.result} (${rouletteColor(result.game.result)}). ` +
      `${
        result.game.win
          ? `You won ${money(result.game.payout)} total (${money(result.game.net)} profit)`
          : "You lost your bet"
      }. ` +
      `Balance: ${money(result.balance)}`;

    await refresh();
  } catch (error) {
    showError(error.message, "#rouletteResult");
  } finally {
    button.disabled = false;
  }
};

if (location.pathname === "/admin") {
  showPage("admin");
}
