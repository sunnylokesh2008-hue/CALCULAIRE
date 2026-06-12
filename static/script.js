"use strict";

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);

const BOOTSTRAP = JSON.parse(document.getElementById("bootstrapData").textContent);
const MIN_RESULT_AMOUNT = Number(BOOTSTRAP.minResultAmount || 2);
const CSRF_TOKEN = BOOTSTRAP.csrfToken;

const STATE = {
  expr: "",
  result: null,
  mode: "standard",
  angle: "deg",
  memory: 0,
  computing: false,
  history: [],
  insight: null,
  currentLibrary: null,
  calculationId: null,
  practice: null,
};

let currentUser = BOOTSTRAP.user || null;
let ownedPackages = new Set(BOOTSTRAP.ownedPackages || []);

const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const listen = (target, ...args) => {
  if (target) target.addEventListener(...args);
};

const refs = {
  loader: $("loader"),
  loaderBar: $("loaderBar"),
  loaderStatus: $("loaderStatus"),
  nav: $("nav"),
  ambientCanvas: $("ambientCanvas"),
  themeToggle: $("themeToggle"),
  accountShortcut: $("accountShortcut"),
  displayExpr: $("displayExpr"),
  displayResult: $("displayResult"),
  scientificPad: $("scientificPad"),
  sessionModeLabel: $("sessionModeLabel"),
  angleToggle: $("angleToggle"),
  historyList: $("historyList"),
  historySearch: $("historySearch"),
  aiState: $("aiState"),
  aiAnswer: $("aiAnswer"),
  aiFormula: $("aiFormula"),
  aiSteps: $("aiSteps"),
  processingOverlay: $("processingOverlay"),
  procStatus: $("procStatus"),
  procBar: $("procBar"),
  mNodes: $("mNodes"),
  mTflops: $("mTflops"),
  mLatency: $("mLatency"),
  paywall: $("paywall"),
  rcExpr: $("rcExpr"),
  blurValue: $("blurValue"),
  rcModeLabel: $("rcModeLabel"),
  paymentAmount: $("paymentAmount"),
  amountPreview: $("amountPreview"),
  payBtn: $("payBtn"),
  revealOverlay: $("revealOverlay"),
  accountLoginShortcut: $("accountLoginShortcut"),
  accountAdminShortcut: $("accountAdminShortcut"),
  revealCanvas: $("revealCanvas"),
  revealAnswer: $("revealAnswer"),
  revealExpr: $("revealExpr"),
  revealModeText: $("revealModeText"),
  revealAgain: $("revealAgain"),
  accountPanel: $("accountPanel"),
  accountStatus: $("accountStatus"),
  accountSummary: $("accountSummary"),
  accountName: $("accountName"),
  accountEmail: $("accountEmail"),
  accountVerified: $("accountVerified"),
  authTabs: $("authTabs"),
  authMessage: $("authMessage"),
  loginForm: $("loginForm"),
  registerForm: $("registerForm"),
  verifyForm: $("verifyForm"),
  resetForm: $("resetForm"),
  resendOtp: $("resendOtp"),
  logoutBtn: $("logoutBtn"),
  libraryTitle: $("libraryTitle"),
  librarySearch: $("librarySearch"),
  libraryContent: $("libraryContent"),
  practiceBtn: $("practiceBtn"),
  toast: $("toast"),
};

const MODE_LABELS = {
  standard: "STANDARD COMPUTATION",
  scientific: "SCIENTIFIC COMPUTATION",
};

// Ensure footer year is accurate without relying on server-side Jinja
document.addEventListener("DOMContentLoaded", () => {
  const fy = document.getElementById("footerYear");
  if (fy) fy.textContent = new Date().getFullYear();
});

const PROCESS_STEPS = [
  ["Initializing calculation engine", 9],
  ["Parsing mathematical structure", 22],
  ["Normalizing operators and constants", 36],
  ["Resolving scientific scope", 51],
  ["Preparing verified insight", 68],
  ["Sealing result vault", 86],
  ["Computation complete", 100],
];

function toast(message) {
  refs.toast.textContent = message;
  refs.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => refs.toast.classList.remove("show"), 3600);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": CSRF_TOKEN,
      ...(options.headers || {}),
    },
    ...options,
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
}

async function performLogout() {
  try {
    await api("/auth/logout", { method: "POST", body: "{}" });
  } catch {
    // ignore errors during logout
  }
  currentUser = null;
  ownedPackages = new Set();
  STATE.history = [];
  STATE.currentLibrary = null;
  renderHistory();
  refs.authMessage.textContent = "Logged out.";
  updateAccountUI();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function prettyExpr(expr) {
  if (!expr) return "0";
  return expr
    .replace(/\*/g, "×")
    .replace(/\//g, "÷")
    .replace(/-/g, "−")
    .replace(/\bpi\b/g, "π")
    .replace(/\bInfinity\b/g, "∞");
}

function formatNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return String(value);
  if (Math.abs(value) >= 1e12 || (Math.abs(value) > 0 && Math.abs(value) < 1e-8)) {
    return Number(value.toPrecision(12)).toExponential(8);
  }
  return Number(value.toPrecision(13)).toString();
}

function updateDisplay() {
  refs.displayExpr.textContent = STATE.expr ? prettyExpr(STATE.expr) : "0";
  if (STATE.computing) {
    refs.displayResult.textContent = "Computing...";
    refs.displayResult.classList.add("processing");
  } else if (STATE.result !== null) {
    refs.displayResult.textContent = formatNumber(STATE.result);
    refs.displayResult.classList.remove("processing");
  } else {
    refs.displayResult.textContent = STATE.expr.trim() ? "Awaiting Computation" : "Ready";
    refs.displayResult.classList.remove("processing");
  }
  refs.sessionModeLabel.textContent = STATE.mode === "scientific" ? "Scientific" : "Standard";
  refs.angleToggle.textContent = STATE.angle.toUpperCase();
}

function updateInsight(locked = false) {
  if (!STATE.insight) {
    refs.aiState.textContent = "Idle";
    refs.aiAnswer.textContent = "--";
    refs.aiFormula.textContent = "Formula will appear after calculation.";
    refs.aiSteps.innerHTML = "";
    return;
  }

  refs.aiState.textContent = locked ? "Vaulted" : "Ready";
  refs.aiAnswer.textContent = locked ? "Locked" : STATE.insight.answer;
  refs.aiFormula.textContent = `${STATE.insight.formula} · ${STATE.insight.explanation}`;
  refs.aiSteps.innerHTML = STATE.insight.steps.map((step) => `<div>${escapeHtml(step)}</div>`).join("");
}

function renderHistory() {
  if (!STATE.history.length) {
    refs.historyList.innerHTML = '<div class="empty-state">No calculations yet.</div>';
    return;
  }

  refs.historyList.innerHTML = STATE.history.map((item, index) => `
    <div class="history-item">
      <button type="button" data-history-index="${index}">${escapeHtml(prettyExpr(item.expression))} = ${escapeHtml(item.result)}</button>
      <small>${escapeHtml(item.mode)}</small>
    </div>
  `).join("");
}

function insertToken(token) {
  if (STATE.expr.length > 140) return;
  STATE.expr += token;
  STATE.result = null;
  updateDisplay();
}

function handleAction(action) {
  if (action === "clear") {
    STATE.expr = "";
    STATE.result = null;
    STATE.insight = null;
    updateInsight();
  }

  if (action === "backspace") {
    STATE.expr = STATE.expr.slice(0, -1);
    STATE.result = null;
  }

  if (action === "copy") {
    const text = STATE.result !== null ? formatNumber(STATE.result) : STATE.expr;
    navigator.clipboard?.writeText(text).then(() => toast("Copied to clipboard."));
  }

  if (action === "calculate") {
    triggerComputation();
    return;
  }

  if (action === "memory-clear") {
    STATE.memory = 0;
    toast("Memory cleared.");
  }

  if (action === "memory-recall") {
    insertToken(formatNumber(STATE.memory));
    return;
  }

  if (action === "memory-add" || action === "memory-subtract") {
    if (STATE.result === null) {
      toast("Unlock a result before storing it in memory.");
      return;
    }
    const value = Number(STATE.result);
    STATE.memory += action === "memory-add" ? value : -value;
    toast(`Memory ${action === "memory-add" ? "added" : "subtracted"}: ${formatNumber(STATE.memory)}`);
  }

  updateDisplay();
}

function createRipple(target, event) {
  const rect = target.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const ripple = document.createElement("span");
  ripple.className = "key-ripple";
  ripple.style.width = `${size}px`;
  ripple.style.height = `${size}px`;
  ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
  ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
  target.appendChild(ripple);
  ripple.addEventListener("animationend", () => ripple.remove());
}

function bindCalculator() {
  $$(".key, .mini-btn").forEach((button) => {
    button.addEventListener("click", (event) => {
      createRipple(button, event);
      const action = button.dataset.action;
      const token = button.dataset.token;
      if (action) handleAction(action);
      if (token) insertToken(token);
    });
  });

  $$(".segment").forEach((button) => {
    button.addEventListener("click", () => {
      $$(".segment").forEach((segment) => segment.classList.remove("active"));
      button.classList.add("active");
      STATE.mode = button.dataset.mode;
      refs.scientificPad.classList.toggle("active", STATE.mode === "scientific");
      updateDisplay();
    });
  });

  listen(refs.angleToggle, "click", () => {
    STATE.angle = STATE.angle === "deg" ? "rad" : "deg";
    updateDisplay();
    toast(`Angle mode: ${STATE.angle.toUpperCase()}`);
  });

  listen(refs.historyList, "click", (event) => {
    const button = event.target.closest("[data-history-index]");
    if (!button) return;
    const item = STATE.history[Number(button.dataset.historyIndex)];
    if (!item) return;
    STATE.expr = item.expression;
    STATE.result = item.result;
    STATE.mode = item.mode || "standard";
    STATE.insight = item.insight || null;
    updateDisplay();
    updateInsight(false);
  });

  let historyTimer;
  listen(refs.historySearch, "input", () => {
    clearTimeout(historyTimer);
    historyTimer = setTimeout(loadServerHistory, 220);
  });

  document.addEventListener("keydown", (event) => {
    if (event.target.matches("input, textarea")) return;

    const allowed = "0123456789+-*/().%^!,";
    if (allowed.includes(event.key)) {
      event.preventDefault();
      insertToken(event.key);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      triggerComputation();
    }
    if (event.key === "Backspace") {
      event.preventDefault();
      handleAction("backspace");
    }
    if (event.key === "Escape") {
      event.preventDefault();
      handleAction("clear");
    }
  });
}

function shakeDisplay() {
  gsap.fromTo(refs.displayExpr, { x: -8 }, { x: 8, duration: 0.06, yoyo: true, repeat: 7, onComplete: () => gsap.set(refs.displayExpr, { x: 0 }) });
  refs.displayResult.textContent = "Check expression";
}

async function triggerComputation() {
  if (STATE.computing || !STATE.expr.trim()) return;

  STATE.result = null;
  STATE.insight = null;
  STATE.calculationId = null;
  STATE.computing = true;
  refs.processingOverlay.classList.add("active");
  refs.procBar.style.width = "0%";
  refs.mNodes.textContent = "0";
  refs.mTflops.textContent = "0.00";
  refs.mLatency.textContent = "--";
  refs.displayResult.textContent = "Computing...";
  updateInsight();

  const calculationRequest = api("/api/calculations", {
    method: "POST",
    body: JSON.stringify({ expression: STATE.expr, mode: STATE.mode, angle: STATE.angle }),
  }).then((payload) => ({ payload }), (error) => ({ error }));

  let stepIndex = 0;
  let nodes = 0;
  let tflops = 0;
  const metricTimer = setInterval(() => {
    nodes = Math.min(47, nodes + Math.ceil(Math.random() * 5));
    tflops += Math.random() * 2.8;
    refs.mNodes.textContent = String(nodes);
    refs.mTflops.textContent = tflops.toFixed(2);
  }, 115);

  function nextStep() {
    const step = PROCESS_STEPS[stepIndex];
    refs.procStatus.textContent = step[0];
    refs.procBar.style.width = `${step[1]}%`;
    stepIndex += 1;

    if (stepIndex < PROCESS_STEPS.length) {
      setTimeout(nextStep, 240 + Math.random() * 160);
      return;
    }

    clearInterval(metricTimer);
    refs.mNodes.textContent = "47";
    refs.mLatency.textContent = `${(Math.random() * 5 + 1.6).toFixed(1)}ms`;

    setTimeout(async () => {
      try {
        const outcome = await calculationRequest;
        if (outcome.error) throw outcome.error;
        const { payload } = outcome;
        STATE.result = payload.result;
        STATE.insight = payload.insight;
        STATE.calculationId = payload.calculation_id;
        refs.processingOverlay.classList.remove("active");
        STATE.computing = false;
        refs.displayResult.textContent = formatNumber(STATE.result);
        // Load server history if logged in, otherwise skip
        if (currentUser) loadServerHistory();

      } catch (error) {
        refs.processingOverlay.classList.remove("active");
        STATE.computing = false;
        shakeDisplay();
        toast(error.message || "Expression could not be evaluated.");
      }
    }, 360);
  }

  setTimeout(nextStep, 120);
}

function showPaywall() {
  // Paywall removed: results always visible. This function is now a no-op.
}

function bindPayment() {
  // Result payment disabled: results now visible without payment
  // Package purchases still available through package-buy buttons
  $$(".package-buy").forEach((button) => {
    button.addEventListener("click", () => startPackagePayment(button.dataset.package));
  });
}

async function startResultPayment() {
  if (!STATE.calculationId) {
    toast("Compute the expression again to create a secure result ticket.");
    return;
  }
  const amount = Math.max(MIN_RESULT_AMOUNT, Math.floor(Number(refs.paymentAmount.value) || MIN_RESULT_AMOUNT));
  refs.paymentAmount.value = String(amount);
  refs.amountPreview.textContent = amount.toFixed(2);

  if (!window.Razorpay) {
    toast("Razorpay checkout is unavailable.");
    return;
  }

  refs.payBtn.disabled = true;

  try {
    const order = await api("/create-order", {
      method: "POST",
      body: JSON.stringify({
        purpose: "result_unlock",
        amount,
        calculation_id: STATE.calculationId,
      }),
    });
    openRazorpay(order, {
      name: "CALCULAIRE Elite",
      description: "Unlock verified result",
      purpose: "result_unlock",
      onVerified: (verified) => {
        STATE.result = verified.result;
        STATE.insight = verified.insight;
        triggerReveal();
        loadServerHistory();
      },
      onClosed: () => {
        refs.payBtn.disabled = false;
      },
    });
  } catch (error) {
    refs.payBtn.disabled = false;
    toast(error.message);
  }
}

async function startPackagePayment(packageCode) {
  if (!currentUser) {
    refs.authMessage.textContent = "Please login or create an account before purchasing.";
    focusAuth("login");
    return;
  }
  if (!currentUser.is_verified) {
    toast("Verify your email before purchasing.");
    focusAuth("verify");
    return;
  }
  if (ownedPackages.has(packageCode)) {
    toast("Package already owned.");
    return;
  }
  if (!window.Razorpay) {
    toast("Razorpay checkout is unavailable.");
    return;
  }

  const button = document.querySelector(`[data-package="${packageCode}"]`);
  button.disabled = true;
  try {
    const order = await api("/create-order", {
      method: "POST",
      body: JSON.stringify({ purpose: "package", package: packageCode }),
    });
    openRazorpay(order, {
      name: "CALCULAIRE Math Library",
      description: packageCode === "tables" ? "Tables Package" : packageCode === "squares" ? "Squares Package" : "Math Master Bundle",
      purpose: "package",
      package: packageCode,
      onVerified: () => {
        ownedPackages.add(packageCode);
        if (packageCode === "bundle") {
          ownedPackages.add("tables");
          ownedPackages.add("squares");
        }
        updatePackageCards();
        openPackage(packageCode === "bundle" ? "tables" : packageCode);
        toast("Lifetime access unlocked.");
      },
      onClosed: () => {
        button.disabled = false;
      },
    });
  } catch (error) {
    button.disabled = false;
    toast(error.message);
  }
}

function openRazorpay(order, config) {
  const checkout = new Razorpay({
    key: order.key,
    amount: order.amount,
    currency: "INR",
    name: config.name,
    description: config.description,
    order_id: order.order_id,
    handler: async (response) => {
      try {
        const verified = await api("/verify-payment", {
          method: "POST",
          body: JSON.stringify({
            order_id: order.order_id,
            payment_id: response.razorpay_payment_id,
            signature: response.razorpay_signature,
          }),
        });

        if (!verified.verified) throw new Error("Payment verification failed.");
        config.onVerified?.(verified);
      } catch (error) {
        toast(error.message || "Payment verification failed.");
        config.onClosed?.();
      }
    },
    modal: {
      ondismiss: () => config.onClosed?.(),
    },
    theme: {
      color: "#d8b66a",
    },
  });

  checkout.on("payment.failed", () => {
    toast("Payment failed.");
    config.onClosed?.();
  });

  checkout.open();
}

function triggerReveal() {
  refs.revealAnswer.textContent = formatNumber(STATE.result);
  refs.revealExpr.textContent = `${prettyExpr(STATE.expr)} = ${formatNumber(STATE.result)}`;
  refs.revealModeText.textContent = `${MODE_LABELS[STATE.mode]} · Server insight verified`;
  updateInsight(false);
  updateDisplay();
  refs.revealOverlay.classList.add("active");
  initRevealCanvas();
}

let revealAnim = null;
function initRevealCanvas() {
  cancelAnimationFrame(revealAnim);
  const canvas = refs.revealCanvas;
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(innerWidth * dpr);
  canvas.height = Math.floor(innerHeight * dpr);
  canvas.style.width = `${innerWidth}px`;
  canvas.style.height = `${innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const centerX = innerWidth / 2;
  const centerY = innerHeight / 2;
  const accentRgb = getComputedStyle(document.documentElement).getPropertyValue("--accent-rgb")?.trim() || "216,182,106";
  const particles = Array.from({ length: 190 }, () => ({
    x: centerX,
    y: centerY,
    vx: (Math.random() - 0.5) * 14,
    vy: (Math.random() - 0.5) * 14,
    life: Math.random() * 0.6 + 0.4,
    size: Math.random() * 3 + 1,
    hue: Math.random() > 0.34 ? accentRgb : "94,161,255",
  }));

  let ring = 0;
  function frame() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ring += 10;
    ctx.globalAlpha = Math.max(0, 1 - ring / 620);
    ctx.strokeStyle = `rgba(${accentRgb},0.7)`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, ring, 0, Math.PI * 2);
    ctx.stroke();

    particles.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.986;
      p.vy *= 0.986;
      p.life -= 0.007;
      if (p.life <= 0) {
        p.x = centerX;
        p.y = centerY;
        p.vx = (Math.random() - 0.5) * 10;
        p.vy = (Math.random() - 0.5) * 10;
        p.life = 0.65;
      }
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = `rgb(${p.hue})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    revealAnim = requestAnimationFrame(frame);
  }
  frame();
}

function resetComputation() {
  cancelAnimationFrame(revealAnim);
  refs.revealOverlay.classList.remove("active");
  refs.paywall.hidden = true;
  STATE.expr = "";
  STATE.result = null;
  STATE.insight = null;
  STATE.calculationId = null;
  STATE.computing = false;
  refs.payBtn.disabled = false;
  refs.procBar.style.width = "0%";
  updateDisplay();
  updateInsight();
  gsap.to(window, { scrollTo: { y: "#calculator", offsetY: 72 }, duration: 0.75, ease: "power3.inOut" });
}

function applyTheme(theme, persist = true) {
  const next = ["dark", "light", "gold"].includes(theme) ? theme : "dark";
  document.body.dataset.theme = next;
  localStorage.setItem("calculaire-theme", next);
  if (persist && currentUser) {
    currentUser.theme = next;
    api("/api/theme", { method: "POST", body: JSON.stringify({ theme: next }) }).catch(() => {});
  }
}

function bindTheme() {
  const stored = localStorage.getItem("calculaire-theme");
  // Prevent visual flicker on initial theme application by disabling transitions briefly
  const prevTransition = document.documentElement.style.transition || "";
  document.documentElement.style.transition = "none";
  applyTheme(currentUser?.theme || stored || document.body.dataset.theme || "dark", false);
  requestAnimationFrame(() => {
    document.documentElement.style.transition = prevTransition;
  });
  listen(refs.themeToggle, "click", () => {
    const themes = ["dark", "light", "gold"];
    const next = themes[(themes.indexOf(document.body.dataset.theme) + 1) % themes.length];
    applyTheme(next);
    toast(`${next[0].toUpperCase()}${next.slice(1)} theme active.`);
  });
}

function focusAuth(tab) {
  refs.accountPanel?.scrollIntoView({ behavior: "smooth", block: "center" });
  setAuthTab(tab);
  if (!$(`${tab}Form`)) openAuthModal();
}

function setAuthTab(tab) {
  $$(".auth-tab").forEach((button) => button.classList.toggle("active", button.dataset.authTab === tab));
  $$(".auth-form").forEach((form) => form.classList.remove("active"));
  const target = $(`${tab}Form`);
  if (target) target.classList.add("active");
}

function describeOtp(payload) {
  if (!payload?.otp) return "";
  return payload.otp.sent ? " Check your email." : "";
}

function updateAccountUI() {
  const accountActions = document.getElementById("accountActions");
  if (refs.accountSummary) refs.accountSummary.hidden = false;

  if (currentUser) {
    if (refs.accountStatus) refs.accountStatus.textContent = currentUser.is_verified ? "Verified" : "Verify Email";
    if (refs.authTabs) refs.authTabs.hidden = true;
    $$(".auth-form").forEach((form) => form.classList.remove("active"));
    if (refs.accountName) refs.accountName.textContent = currentUser.name;
    if (refs.accountEmail) refs.accountEmail.textContent = currentUser.email;
    if (refs.accountVerified) refs.accountVerified.textContent = currentUser.is_verified ? "Verified" : "Pending";
    if (!currentUser.is_verified) {
      if (refs.authTabs) refs.authTabs.hidden = false;
      setAuthTab("verify");
    }
    if (refs.accountShortcut) refs.accountShortcut.textContent = currentUser.name;
    if (accountActions) accountActions.hidden = true;
    const accessPanelGuest = document.getElementById("accessPanelGuest");
    const accessPanelUser = document.getElementById("accessPanelUser");
    if (accessPanelGuest) accessPanelGuest.hidden = true;
    if (accessPanelUser) accessPanelUser.hidden = false;
  } else {
    refs.accountStatus.textContent = "Guest";
    if (refs.authTabs) refs.authTabs.hidden = false;
    if (!$(".auth-form.active")) setAuthTab("login");
    refs.accountName.textContent = "Guest";
    refs.accountEmail.textContent = "—";
    refs.accountVerified.textContent = "Guest";
    refs.accountShortcut.textContent = "Access Portal";
    if (accountActions) accountActions.hidden = false;
    const accessPanelGuest = document.getElementById("accessPanelGuest");
    const accessPanelUser = document.getElementById("accessPanelUser");
    if (accessPanelGuest) accessPanelGuest.hidden = false;
    if (accessPanelUser) accessPanelUser.hidden = true;
  }
  updatePackageCards();
}

function openAuthModal() {
  const modal = document.getElementById("authModal");
  if (!modal) return;
  modal.setAttribute("aria-hidden", "false");
}

function closeAuthModal() {
  const modal = document.getElementById("authModal");
  if (!modal) return;
  modal.setAttribute("aria-hidden", "true");
  // Reset form tab to login
  const tabs = modal.querySelectorAll(".auth-modal-tab");
  tabs.forEach((tab) => tab.classList.remove("active"));
  if (tabs[0]) tabs[0].classList.add("active");
  const forms = modal.querySelectorAll(".auth-modal-form");
  forms.forEach((form) => form.classList.remove("active"));
  if (forms[0]) forms[0].classList.add("active");
  const msg = document.getElementById("authModalMessage");
  if (msg) msg.classList.remove("show");
}

function openAuthModal() {
  const modal = document.getElementById("authModal");
  if (!modal) return;
  modal.setAttribute("aria-hidden", "false");
}

function closeAuthModal() {
  const modal = document.getElementById("authModal");
  if (!modal) return;
  modal.setAttribute("aria-hidden", "true");
  // Reset form tab to login
  const tabs = modal.querySelectorAll(".auth-modal-tab");
  tabs.forEach((tab) => tab.classList.remove("active"));
  if (tabs[0]) tabs[0].classList.add("active");
  const forms = modal.querySelectorAll(".auth-modal-form");
  forms.forEach((form) => form.classList.remove("active"));
  if (forms[0]) forms[0].classList.add("active");
  const msg = document.getElementById("authModalMessage");
  if (msg) msg.classList.remove("show");
}

function bindAuth() {
  // Access dropdown: toggle / route to auth panels or admin login
  const accessBtn = refs.accountShortcut;
  const accessDropdown = document.getElementById("accessDropdown");

  function openAccessDropdown() {
    if (!accessDropdown) return;
    accessDropdown.setAttribute("aria-hidden", "false");
    if (accessBtn) accessBtn.setAttribute("aria-expanded", "true");
    accessDropdown.classList.add("open");
  }

  function closeAccessDropdown() {
    if (!accessDropdown) return;
    accessDropdown.setAttribute("aria-hidden", "true");
    if (accessBtn) accessBtn.setAttribute("aria-expanded", "false");
    accessDropdown.classList.remove("open");
  }

  function toggleAccessDropdown() {
    if (!accessDropdown) return;
    accessDropdown.getAttribute("aria-hidden") === "true" ? openAccessDropdown() : closeAccessDropdown();
  }

  listen(accessBtn, "click", (e) => {
    e.stopPropagation();
    toggleAccessDropdown();
  });

  // keyboard accessibility for dropdown
  listen(accessBtn, "keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleAccessDropdown();
      const first = accessDropdown && accessDropdown.querySelector('.access-item');
      if (first) first.focus();
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      openAccessDropdown();
      const first = accessDropdown && accessDropdown.querySelector('.access-item');
      if (first) first.focus();
    }
  });

  if (accessDropdown) {
    accessDropdown.addEventListener("click", (e) => {
      const item = e.target.closest(".access-item");
      if (!item) return;
      const action = item.dataset.accessAction;
      if (!action) return;
      
      if (action === "admin") {
        closeAccessDropdown();
        window.location.href = "/admin/login";
        return;
      }
      
      if (action === "logout") {
        closeAccessDropdown();
        performLogout();
        return;
      }
      
      if (action === "my-account") {
        closeAccessDropdown();
        focusAuth("account");
        return;
      }
      
      if (action === "my-purchases") {
        closeAccessDropdown();
        // Scroll to library section
        const library = document.getElementById("library");
        if (library) library.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      
      // user actions (login, register) -> focus account panel tabs
      closeAccessDropdown();
      focusAuth(action);
    });
    // Allow keyboard navigation inside dropdown
    accessDropdown.addEventListener('keydown', (e) => {
      const items = Array.from(accessDropdown.querySelectorAll('.access-item'));
      const idx = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = items[(idx + 1) % items.length];
        if (next) next.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = items[(idx - 1 + items.length) % items.length];
        if (prev) prev.focus();
      } else if (e.key === 'Escape') {
        closeAccessDropdown();
        accessBtn?.focus();
      }
    });
  }

  // Close dropdown on outside click or Escape
  document.addEventListener("click", (e) => {
    if (!accessDropdown) return;
    if (!accessDropdown.contains(e.target) && e.target !== accessBtn) closeAccessDropdown();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAccessDropdown();
  });

  $$(".auth-tab").forEach((button) => {
    button.addEventListener("click", () => setAuthTab(button.dataset.authTab));
  });

  const accountLoginShortcut = refs.accountLoginShortcut;
  const accountAdminShortcut = refs.accountAdminShortcut;

  accountLoginShortcut?.addEventListener("click", () => {
    refs.authMessage.textContent = "Please login or create an account before purchasing.";
    focusAuth("login");
  });

  accountAdminShortcut?.addEventListener("click", () => {
    window.location.href = "/admin/login";
  });

  listen(refs.loginForm, "submit", async (event) => {
    event.preventDefault();
    const form = new FormData(refs.loginForm);
    try {
      const payload = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      currentUser = payload.user;
      ownedPackages = new Set(payload.owned_packages || []);
      applyTheme(currentUser.theme, false);
      refs.authMessage.textContent = currentUser.is_verified ? "Welcome back." : "Login complete. Verify your email to purchase.";
      updateAccountUI();
      loadServerHistory();
    } catch (error) {
      refs.authMessage.textContent = error.message;
    }
  });

  listen(refs.registerForm, "submit", async (event) => {
    event.preventDefault();
    const form = new FormData(refs.registerForm);
    try {
      const payload = await api("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          email: form.get("email"),
          password: form.get("password"),
        }),
      });
      currentUser = payload.user;
      applyTheme(currentUser.theme, false);
      refs.authMessage.textContent = `Account created.${describeOtp(payload)}`;
      updateAccountUI();
      setAuthTab("verify");
    } catch (error) {
      refs.authMessage.textContent = error.message;
    }
  });

  listen(refs.verifyForm, "submit", async (event) => {
    event.preventDefault();
    const form = new FormData(refs.verifyForm);
    try {
      const payload = await api("/auth/verify-otp", {
        method: "POST",
        body: JSON.stringify({ otp: form.get("otp") }),
      });
      currentUser = payload.user;
      refs.authMessage.textContent = "Email verified. Premium purchases are enabled.";
      updateAccountUI();
    } catch (error) {
      refs.authMessage.textContent = error.message;
    }
  });

  listen(refs.resendOtp, "click", async () => {
    try {
      const payload = await api("/auth/resend-otp", { method: "POST", body: "{}" });
      refs.authMessage.textContent = `Verification code sent.${describeOtp(payload)}`;
    } catch (error) {
      refs.authMessage.textContent = error.message;
    }
  });

  listen(refs.resetForm, "submit", async (event) => {
    event.preventDefault();
    const form = new FormData(refs.resetForm);
    const email = form.get("email");
    const otp = form.get("otp");
    const password = form.get("password");

    try {
      if (!otp || !password) {
        const payload = await api("/auth/request-reset", {
          method: "POST",
          body: JSON.stringify({ email }),
        });
        refs.authMessage.textContent = `${payload.message || "Reset code issued."}${describeOtp(payload)}`;
        refs.resetForm.querySelector("[data-reset-stage]").textContent = "Reset Password";
        return;
      }

      await api("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ email, otp, password }),
      });
      refs.authMessage.textContent = "Password reset complete. You can log in now.";
      setAuthTab("login");
    } catch (error) {
      refs.authMessage.textContent = error.message;
    }
  });

  listen(refs.logoutBtn, "click", async () => {
    await performLogout();
  });

  // Auth modal handlers for purchase gate
  const authModal = document.getElementById("authModal");
  const authModalClose = document.getElementById("authModalClose");
  const authModalTabs = authModal?.querySelectorAll(".auth-modal-tab");
  const authModalLoginForm = document.getElementById("authModalLoginForm");
  const authModalRegisterForm = document.getElementById("authModalRegisterForm");
  const authModalMessage = document.getElementById("authModalMessage");
  const authModalOverlay = authModal?.querySelector(".auth-modal-overlay");

  if (authModalClose) {
    authModalClose.addEventListener("click", closeAuthModal);
  }

  if (authModalOverlay) {
    authModalOverlay.addEventListener("click", closeAuthModal);
  }

  if (authModalTabs) {
    authModalTabs.forEach((tab) => {
      tab.addEventListener("click", (e) => {
        const mode = tab.dataset.authMode;
        authModalTabs.forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        const forms = authModal.querySelectorAll(".auth-modal-form");
        forms.forEach((form) => form.classList.remove("active"));
        const targetForm = authModal.querySelector(`#authModal${mode.charAt(0).toUpperCase() + mode.slice(1)}Form`);
        if (targetForm) targetForm.classList.add("active");
        if (authModalMessage) authModalMessage.classList.remove("show");
      });
    });
  }

  if (authModalLoginForm) {
    authModalLoginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(authModalLoginForm);
      try {
        const payload = await api("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
        });
        currentUser = payload.user;
        ownedPackages = new Set(payload.owned_packages || []);
        applyTheme(currentUser.theme, false);
        updateAccountUI();
        closeAuthModal();
        toast("Welcome back. You can now purchase packages.");
        loadServerHistory();
      } catch (error) {
        if (authModalMessage) {
          authModalMessage.textContent = error.message;
          authModalMessage.classList.add("show");
        }
      }
    });
  }

  if (authModalRegisterForm) {
    authModalRegisterForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(authModalRegisterForm);
      try {
        const payload = await api("/auth/register", {
          method: "POST",
          body: JSON.stringify({
            name: form.get("name"),
            email: form.get("email"),
            password: form.get("password"),
          }),
        });
        currentUser = payload.user;
        applyTheme(currentUser.theme, false);
        updateAccountUI();
        closeAuthModal();
        toast("Account created. Verify your email to purchase packages.");
        // Auto-switch to verify modal? Or just close for now
      } catch (error) {
        if (authModalMessage) {
          authModalMessage.textContent = error.message;
          authModalMessage.classList.add("show");
        }
      }
    });
  }
}

async function loadServerHistory() {
  if (!currentUser) return;
  try {
    const query = refs.historySearch.value.trim();
    const payload = await api(`/api/history?q=${encodeURIComponent(query)}`);
    STATE.history = (payload.history || []).map((item) => ({
      expression: item.expression,
      result: item.result,
      mode: item.mode,
      insight: item.insight,
      created_at: item.created_at,
    }));
    renderHistory();
  } catch {
    renderHistory();
  }
}

function updatePackageCards() {
  $$(".package-card").forEach((card) => {
    const code = card.dataset.packageCard;
    card.classList.toggle("owned", ownedPackages.has(code));
  });
}

function bindLibrary() {
  $$(".package-open").forEach((button) => {
    button.addEventListener("click", () => openPackage(button.dataset.openPackage));
  });

  listen(refs.librarySearch, "input", () => renderLibrary());
  listen(refs.practiceBtn, "click", () => {
    STATE.practice = STATE.practice ? null : createPracticeQuestion();
    refs.practiceBtn.textContent = STATE.practice ? "Close Practice" : "Practice";
    renderLibrary();
  });

  listen(refs.libraryContent, "submit", (event) => {
    if (!event.target.matches("[data-practice-form]")) return;
    event.preventDefault();
    const answer = Number(new FormData(event.target).get("answer"));
    const feedback = event.target.querySelector("[data-practice-feedback]");
    if (answer === STATE.practice.answer) {
      feedback.textContent = "Correct. New challenge loaded.";
      STATE.practice = createPracticeQuestion();
      setTimeout(renderLibrary, 650);
    } else {
      feedback.textContent = "Not quite. Try once more.";
    }
  });
}

function createPracticeQuestion() {
  const left = Math.floor(Math.random() * 100) + 1;
  const right = Math.floor(Math.random() * 10) + 1;
  return { left, right, answer: left * right };
}

async function openPackage(packageCode) {
  if (!currentUser) {
    toast("Login required.");
    focusAuth("login");
    return;
  }
  if (!currentUser.is_verified) {
    toast("Email verification required.");
    focusAuth("verify");
    return;
  }
  if (!ownedPackages.has(packageCode)) {
    toast("Purchase required.");
    return;
  }

  refs.libraryTitle.textContent = packageCode === "tables" ? "Tables 1-100" : "Squares 1-1000";
  refs.practiceBtn.hidden = packageCode !== "tables";
  STATE.practice = null;
  refs.practiceBtn.textContent = "Practice";
  refs.libraryContent.innerHTML = '<div class="empty-state">Opening vault...</div>';

  try {
    const payload = await api(`/api/library/${packageCode}`);
    STATE.currentLibrary = payload;
    refs.librarySearch.value = "";
    renderLibrary();
  } catch (error) {
    refs.libraryContent.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function renderLibrary() {
  if (!STATE.currentLibrary) return;

  if (STATE.practice && STATE.currentLibrary.package === "tables") {
    refs.libraryContent.innerHTML = `
      <form class="practice-card" data-practice-form>
        <span>Interactive tables practice</span>
        <strong>${STATE.practice.left} × ${STATE.practice.right} = ?</strong>
        <input name="answer" type="number" inputmode="numeric" aria-label="Practice answer" required autofocus />
        <button class="primary-btn" type="submit">Check Answer</button>
        <p data-practice-feedback aria-live="polite"></p>
      </form>
    `;
    refs.libraryContent.querySelector("input")?.focus();
    return;
  }

  const term = refs.librarySearch.value.trim();
  const packageCode = STATE.currentLibrary.package;
  const items = STATE.currentLibrary.items.filter((item) => !term || String(item.n).includes(term));

  if (!items.length) {
    refs.libraryContent.innerHTML = '<div class="empty-state">No matching number.</div>';
    return;
  }

  if (packageCode === "tables") {
    refs.libraryContent.innerHTML = `
      <div class="table-grid">
        ${items.map((item) => `
          <div class="library-item">
            <strong>Table ${item.n}</strong>
            <span>${item.values.map((value, index) => `${item.n} × ${index + 1} = ${value}`).join("<br>")}</span>
          </div>
        `).join("")}
      </div>
    `;
    return;
  }

  refs.libraryContent.innerHTML = `
    <div class="square-grid">
      ${items.map((item) => `
        <div class="library-item">
          <strong>${item.n}</strong>
          <span>Square: ${item.square}<br>Cube: ${item.cube}<br>√n: ${item.square_root}<br>∛n: ${item.cube_root}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function initMotion() {
  ScrollTrigger.create({
    start: "top -20",
    onUpdate: (self) => refs.nav.classList.toggle("scrolled", self.progress > 0),
  });

  $$('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      const target = document.querySelector(link.getAttribute("href"));
      if (!target) return;
      event.preventDefault();
      gsap.to(window, { scrollTo: { y: target, offsetY: 74 }, duration: 0.9, ease: "power3.inOut" });
    });
  });

  gsap.utils.toArray(".panel, .package-card, .hero-device").forEach((el) => {
    el.addEventListener("mousemove", (event) => {
      if (innerWidth < 800) return;
      const rect = el.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      gsap.to(el, { rotateY: x * 4, rotateX: -y * 4, y: -2, duration: 0.35, ease: "power2.out" });
    });
    el.addEventListener("mouseleave", () => gsap.to(el, { rotateY: 0, rotateX: 0, y: 0, duration: 0.45, ease: "power2.out" }));
  });

  $$(".magnetic").forEach((el) => {
    el.addEventListener("mousemove", (event) => {
      if (innerWidth < 800) return;
      const rect = el.getBoundingClientRect();
      const x = event.clientX - rect.left - rect.width / 2;
      const y = event.clientY - rect.top - rect.height / 2;
      gsap.to(el, { x: x * 0.12, y: y * 0.18, duration: 0.28, ease: "power2.out" });
    });
    el.addEventListener("mouseleave", () => gsap.to(el, { x: 0, y: 0, duration: 0.35, ease: "power2.out" }));
  });
}

function runLoader() {
  const messages = [
    "Calibrating orbital interface",
    "Loading scientific parser",
    "Synchronizing luxury shaders",
    "Preparing result vault",
    "Ready",
  ];
  let progress = 0;
  let messageIndex = 0;

  const timer = setInterval(() => {
    progress = Math.min(100, progress + Math.random() * 16 + 8);
    refs.loaderBar.style.width = `${progress}%`;
    const next = ((messageIndex + 1) / messages.length) * 100;
    if (progress >= next && messageIndex < messages.length - 1) {
      messageIndex += 1;
      refs.loaderStatus.textContent = messages[messageIndex];
    }
    if (progress >= 100) {
      clearInterval(timer);
      setTimeout(() => refs.loader.classList.add("gone"), 260);
    }
  }, 90);
}

let three = {
  renderer: null,
  scene: null,
  camera: null,
  stars: null,
  nebula: null,
  galaxy: null,
  planets: [],
  asteroids: [],
  satellites: [],
  shootingStar: null,
  raf: null,
  clock: null,
};

function initThreeUniverse() {
  if (!window.THREE || !refs.ambientCanvas) return;

  three.scene = new THREE.Scene();
  three.camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 1800);
  three.camera.position.set(0, 0, 420);
  three.clock = new THREE.Clock();
  three.renderer = new THREE.WebGLRenderer({
    canvas: refs.ambientCanvas,
    alpha: true,
    antialias: false,
    powerPreference: "high-performance",
  });
  three.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  three.renderer.setSize(innerWidth, innerHeight);
  three.renderer.setClearColor(0x000000, 0);

  const starGeo = new THREE.BufferGeometry();
  const starCount = 1200;
  const starPositions = new Float32Array(starCount * 3);
  const starColors = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i += 1) {
    starPositions[i * 3] = (Math.random() - 0.5) * 1200;
    starPositions[i * 3 + 1] = (Math.random() - 0.5) * 760;
    starPositions[i * 3 + 2] = (Math.random() - 0.5) * 1000;
    const warm = Math.random() > 0.76;
    starColors[i * 3] = warm ? 1 : 0.54;
    starColors[i * 3 + 1] = warm ? 0.78 : 0.72;
    starColors[i * 3 + 2] = warm ? 0.42 : 1;
  }
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
  starGeo.setAttribute("color", new THREE.BufferAttribute(starColors, 3));
  three.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    size: 1.3,
    transparent: true,
    opacity: 0.8,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
  three.scene.add(three.stars);

  const nebulaGeo = new THREE.BufferGeometry();
  const nebulaCount = 420;
  const nebulaPositions = new Float32Array(nebulaCount * 3);
  for (let i = 0; i < nebulaCount; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 70 + Math.random() * 390;
    nebulaPositions[i * 3] = Math.cos(angle) * radius;
    nebulaPositions[i * 3 + 1] = Math.sin(angle) * radius * 0.34 + (Math.random() - 0.5) * 80;
    nebulaPositions[i * 3 + 2] = -420 + Math.random() * 500;
  }
  nebulaGeo.setAttribute("position", new THREE.BufferAttribute(nebulaPositions, 3));
  three.nebula = new THREE.Points(nebulaGeo, new THREE.PointsMaterial({
    color: 0x5ea1ff,
    size: 8,
    transparent: true,
    opacity: 0.11,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
  three.scene.add(three.nebula);

  const asteroidMat = new THREE.MeshStandardMaterial({
    color: 0x8e866f,
    roughness: 0.92,
    metalness: 0.18,
    flatShading: true,
  });
  const light = new THREE.DirectionalLight(0xf4d99a, 1.2);
  light.position.set(220, 180, 340);
  three.scene.add(light);
  three.scene.add(new THREE.AmbientLight(0x5ea1ff, 0.5));

  const planetGroup = new THREE.Group();
  const planet = new THREE.Mesh(
    new THREE.SphereGeometry(62, 48, 32),
    new THREE.MeshStandardMaterial({ color: 0x233b63, roughness: 0.72, metalness: 0.08, emissive: 0x08152b })
  );
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(94, 2.2, 8, 96),
    new THREE.MeshBasicMaterial({ color: 0xd8b66a, transparent: true, opacity: 0.34 })
  );
  ring.rotation.x = Math.PI * 0.62;
  planetGroup.add(planet, ring);
  planetGroup.position.set(-360, -90, -390);
  planetGroup.userData = { speed: 0.035, phase: 0 };
  three.planets.push(planetGroup);
  three.scene.add(planetGroup);

  const moonSystem = new THREE.Group();
  const distantPlanet = new THREE.Mesh(
    new THREE.SphereGeometry(31, 36, 24),
    new THREE.MeshStandardMaterial({ color: 0x7d4e3b, roughness: 0.88, metalness: 0.03, emissive: 0x180a05 })
  );
  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(8, 24, 16),
    new THREE.MeshStandardMaterial({ color: 0xb8b3a8, roughness: 1 })
  );
  moon.userData.orbitRadius = 62;
  moonSystem.add(distantPlanet, moon);
  moonSystem.position.set(390, 150, -520);
  moonSystem.userData = { speed: -0.026, moon };
  three.planets.push(moonSystem);
  three.scene.add(moonSystem);

  const galaxyGeometry = new THREE.BufferGeometry();
  const galaxyCount = 680;
  const galaxyPositions = new Float32Array(galaxyCount * 3);
  for (let i = 0; i < galaxyCount; i += 1) {
    const arm = i % 3;
    const radius = 8 + Math.random() * 125;
    const angle = arm * (Math.PI * 2 / 3) + radius * 0.055 + (Math.random() - 0.5) * 0.5;
    galaxyPositions[i * 3] = Math.cos(angle) * radius;
    galaxyPositions[i * 3 + 1] = (Math.random() - 0.5) * 12;
    galaxyPositions[i * 3 + 2] = Math.sin(angle) * radius;
  }
  galaxyGeometry.setAttribute("position", new THREE.BufferAttribute(galaxyPositions, 3));
  three.galaxy = new THREE.Points(galaxyGeometry, new THREE.PointsMaterial({
    color: 0xf4d99a,
    size: 2.2,
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
  three.galaxy.position.set(320, -230, -720);
  three.galaxy.rotation.x = Math.PI * 0.34;
  three.scene.add(three.galaxy);

  for (let i = 0; i < 12; i += 1) {
    const asteroid = new THREE.Mesh(new THREE.SphereGeometry(8 + Math.random() * 16, 22, 14), asteroidMat);
    asteroid.position.set((Math.random() - 0.5) * 940, (Math.random() - 0.5) * 560, -140 - Math.random() * 520);
    asteroid.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    asteroid.userData = {
      speed: 0.06 + Math.random() * 0.14,
      drift: Math.random() * Math.PI * 2,
      scale: 0.9 + Math.random() * 1.1,
    };
    asteroid.scale.setScalar(asteroid.userData.scale);
    three.asteroids.push(asteroid);
    three.scene.add(asteroid);
  }

  const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(80, 22, 0)]);
  three.shootingStar = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xf4d99a, transparent: true, opacity: 0 }));
  three.shootingStar.userData = { timer: 0, active: false };
  three.scene.add(three.shootingStar);

  window.addEventListener("resize", resizeThree);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelAnimationFrame(three.raf);
    } else {
      three.clock.getDelta();
      animateThree();
    }
  });

  animateThree();
}

function resizeThree() {
  if (!three.renderer) return;
  three.camera.aspect = innerWidth / innerHeight;
  three.camera.updateProjectionMatrix();
  three.renderer.setSize(innerWidth, innerHeight);
}

function animateThree() {
  if (!three.renderer || document.hidden) return;
  three.raf = requestAnimationFrame(animateThree);
  const delta = Math.min(0.033, three.clock.getDelta());
  const time = three.clock.elapsedTime;

  three.stars.rotation.y += delta * 0.018;
  three.stars.rotation.x = Math.sin(time * 0.08) * 0.025;
  three.nebula.rotation.z -= delta * 0.012;
  three.galaxy.rotation.y += delta * 0.018;

  three.planets.forEach((system, index) => {
    system.rotation.y += delta * system.userData.speed;
    system.rotation.z = Math.sin(time * 0.08 + index) * 0.04;
    if (system.userData.moon) {
      const moonAngle = time * 0.38;
      system.userData.moon.position.set(Math.cos(moonAngle) * 62, Math.sin(moonAngle * 0.7) * 14, Math.sin(moonAngle) * 62);
    }
  });

  three.asteroids.forEach((asteroid) => {
    asteroid.rotation.x += delta * asteroid.userData.speed;
    asteroid.rotation.y += delta * asteroid.userData.speed * 0.8;
    asteroid.position.x += Math.sin(time * 0.2 + asteroid.userData.drift) * delta * 2.2;
  });

  three.satellites.forEach((satellite) => {
    const data = satellite.userData;
    const angle = time * data.speed + data.phase;
    satellite.position.set(Math.cos(angle) * data.radius, data.y + Math.sin(angle * 0.8) * 20, -150 + Math.sin(angle) * data.radius * 0.35);
    satellite.rotation.y = -angle;
  });

  const shot = three.shootingStar;
  shot.userData.timer -= delta;
  if (shot.userData.timer <= 0 && !shot.userData.active) {
    shot.userData.active = true;
    shot.userData.life = 0.9;
    shot.userData.timer = 2.8 + Math.random() * 4.5;
    shot.position.set(-520 + Math.random() * 220, 250 + Math.random() * 160, -150);
    shot.material.opacity = 0.9;
  }
  if (shot.userData.active) {
    shot.position.x += delta * 520;
    shot.position.y -= delta * 180;
    shot.userData.life -= delta;
    shot.material.opacity = Math.max(0, shot.userData.life);
    if (shot.userData.life <= 0) shot.userData.active = false;
  }

  three.camera.position.x += ((window.scrollY * 0.04) - three.camera.position.x) * 0.02;
  three.camera.lookAt(0, 0, 0);
  three.renderer.render(three.scene, three.camera);
}

function boot() {
  initThreeUniverse();
  initMotion();
  bindTheme();
  bindCalculator();
  bindPayment();
  bindAuth();
  bindLibrary();
  listen(refs.revealAgain, "click", resetComputation);
  updateDisplay();
  updateInsight();
  renderHistory();
  updateAccountUI();
  loadServerHistory();
  runLoader();
}

window.addEventListener("DOMContentLoaded", boot);
